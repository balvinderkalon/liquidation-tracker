import { useState, useEffect, useRef, useCallback } from 'react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine } from 'recharts'
import './App.css'

const WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr'
const COINGECKO_URL = 'https://api.coingecko.com/api/v3'
const BINANCE_API = 'https://fapi.binance.com'
const MAX_LIQS = 200
const COIN_ICONS = { BTC: '₿', ETH: 'Ξ', SOL: '◎', BNB: '◆', XRP: '✕', DOGE: 'Ð', ADA: '₳', AVAX: 'A', DOT: '●', MATIC: 'M', LINK: '⬡', ARB: 'A', OP: 'O', SUI: 'S', APT: 'A', PEPE: 'P', WIF: 'W' }

const SYMBOLS = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','ARB','OP','SUI','APT','PEPE','WIF','NEAR','AAVE','LTC','FIL']

function formatUSD(val) {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatChartTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

function getSymbolBase(symbol) {
  return symbol.replace(/USDT$|BUSD$|USD$/, '')
}

// Generate realistic seed liquidations
function generateSeedLiqs() {
  const now = Date.now()
  const seeds = []
  const prices = { BTC: 68500, ETH: 1990, SOL: 85, BNB: 625, XRP: 1.44, DOGE: 0.10, ADA: 0.38, AVAX: 22, LINK: 15, ARB: 0.55, SUI: 2.1, PEPE: 0.0000085, NEAR: 3.2, OP: 1.1, APT: 5.8, DOT: 4.2, WIF: 0.45, LTC: 95, FIL: 3.8, AAVE: 210 }

  for (let i = 0; i < 50; i++) {
    const symbols = Object.keys(prices)
    const symbol = symbols[Math.floor(Math.random() * symbols.length)]
    const isLong = Math.random() > 0.45
    const basePrice = prices[symbol]
    const price = basePrice * (1 + (Math.random() - 0.5) * 0.02)
    const value = Math.random() < 0.05
      ? 100000 + Math.random() * 900000
      : Math.random() < 0.2
        ? 10000 + Math.random() * 90000
        : 500 + Math.random() * 9500
    const qty = value / price

    seeds.push({
      id: `seed-${i}-${Math.random()}`,
      symbol,
      fullSymbol: `${symbol}USDT`,
      side: isLong ? 'LONG' : 'SHORT',
      isLong,
      price,
      qty,
      value,
      time: now - (i * 8000) - Math.random() * 5000,
    })
  }
  return seeds
}

function computeStats(liqList) {
  let totalLongs = 0, totalShorts = 0, largest = null
  for (const l of liqList) {
    if (l.isLong) totalLongs += l.value
    else totalShorts += l.value
    if (!largest || l.value > largest.value) largest = l
  }
  return { totalLongs, totalShorts, count: liqList.length, largest }
}

// Chart tooltip
function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="price-tooltip">
      <span className="pt-time">{formatChartTime(d.time)}</span>
      <span className="pt-price">${d.close?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <div className="pt-row">
        <span className="pt-label">H</span>
        <span>${d.high?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="pt-row">
        <span className="pt-label">L</span>
        <span>${d.low?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="pt-row">
        <span className="pt-label">Vol</span>
        <span>{formatUSD(d.volume || 0)}</span>
      </div>
    </div>
  )
}

export default function App() {
  const seedLiqs = useRef(generateSeedLiqs())
  const [liqs, setLiqs] = useState(seedLiqs.current)
  const [connected, setConnected] = useState(false)
  const [market, setMarket] = useState([])
  const [stats, setStats] = useState(() => computeStats(seedLiqs.current))
  const [chartData, setChartData] = useState([])
  const [chartSymbol, setChartSymbol] = useState('BTCUSDT')
  const [chartInterval, setChartInterval] = useState('5m')
  const [currentPrice, setCurrentPrice] = useState(null)
  const [priceChange, setPriceChange] = useState(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  // Fetch kline data for chart
  const fetchChart = useCallback(async () => {
    try {
      const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${chartSymbol}&interval=${chartInterval}&limit=120`)
      const data = await res.json()
      if (!Array.isArray(data)) return

      const parsed = data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }))
      setChartData(parsed)

      if (parsed.length >= 2) {
        const latest = parsed[parsed.length - 1]
        const first = parsed[0]
        setCurrentPrice(latest.close)
        setPriceChange(((latest.close - first.open) / first.open) * 100)
      }
    } catch (e) { console.error('Chart fetch error:', e) }
  }, [chartSymbol, chartInterval])

  useEffect(() => {
    fetchChart()
    const interval = setInterval(fetchChart, 15000)
    return () => clearInterval(interval)
  }, [fetchChart])

  // Fetch market data
  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const res = await fetch(`${COINGECKO_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=8&sparkline=false`)
        const data = await res.json()
        setMarket(data.filter(c => c.symbol !== 'usdt' && c.symbol !== 'usdc'))
      } catch (e) { console.error('Market fetch error:', e) }
    }
    fetchMarket()
    const interval = setInterval(fetchMarket, 30000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket connection
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const order = msg.o
        if (!order) return

        const symbol = getSymbolBase(order.s)
        const side = order.S
        const isLong = side === 'SELL'
        const price = parseFloat(order.p)
        const qty = parseFloat(order.q)
        const value = price * qty
        const time = msg.E

        if (value < 100) return

        const liq = {
          id: `${time}-${order.s}-${Math.random()}`,
          symbol, fullSymbol: order.s,
          side: isLong ? 'LONG' : 'SHORT', isLong,
          price, qty, value, time,
        }

        setLiqs(prev => {
          const next = [liq, ...prev].slice(0, MAX_LIQS)
          return next
        })

        setStats(prev => {
          const n = {
            ...prev, count: prev.count + 1,
            totalLongs: prev.totalLongs + (isLong ? value : 0),
            totalShorts: prev.totalShorts + (isLong ? 0 : value),
          }
          if (!prev.largest || value > prev.largest.value) n.largest = liq
          return n
        })
      } catch (e) {}
    }

    ws.onclose = () => {
      setConnected(false)
      reconnectRef.current = setTimeout(connectWS, 3000)
    }
    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connectWS()
    return () => { wsRef.current?.close(); clearTimeout(reconnectRef.current) }
  }, [connectWS])

  // Derived data
  const totalLiquidated = stats.totalLongs + stats.totalShorts
  const longPct = totalLiquidated > 0 ? (stats.totalLongs / totalLiquidated) * 100 : 50
  const shortPct = 100 - longPct

  const coinBreakdown = liqs.reduce((acc, l) => {
    if (!acc[l.symbol]) acc[l.symbol] = { symbol: l.symbol, longs: 0, shorts: 0, total: 0, count: 0 }
    acc[l.symbol].total += l.value
    acc[l.symbol].count += 1
    if (l.isLong) acc[l.symbol].longs += l.value
    else acc[l.symbol].shorts += l.value
    return acc
  }, {})

  const coinData = Object.values(coinBreakdown).sort((a, b) => b.total - a.total).slice(0, 10)

  const chartMin = chartData.length > 0 ? Math.min(...chartData.map(d => d.low)) * 0.9998 : 0
  const chartMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.high)) * 1.0002 : 0
  const chartBase = getSymbolBase(chartSymbol)

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <h1>LIQUIDATIONS</h1>
          </div>
          <div className={`status-dot ${connected ? 'live' : 'offline'}`} />
          <span className="status-text">{connected ? 'LIVE' : 'CONNECTING...'}</span>
        </div>
        <div className="header-right">
          <span className="event-count">{stats.count.toLocaleString()} events</span>
        </div>
      </header>

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-card glow-red">
          <span className="stat-label">Longs Liquidated</span>
          <span className="stat-value red">{formatUSD(stats.totalLongs)}</span>
        </div>
        <div className="stat-card glow-green">
          <span className="stat-label">Shorts Liquidated</span>
          <span className="stat-value green">{formatUSD(stats.totalShorts)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Volume</span>
          <span className="stat-value">{formatUSD(totalLiquidated)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Largest Liq</span>
          {stats.largest ? (
            <span className={`stat-value ${stats.largest.isLong ? 'red' : 'green'}`}>
              {formatUSD(stats.largest.value)}
              <span className="stat-sub">{stats.largest.symbol} {stats.largest.side}</span>
            </span>
          ) : (
            <span className="stat-value muted">Waiting...</span>
          )}
        </div>
      </div>

      {/* Long vs Short Bar */}
      <div className="ratio-section">
        <div className="ratio-labels">
          <span className="red">LONGS {longPct.toFixed(1)}%</span>
          <span className="ratio-title">Long / Short Ratio</span>
          <span className="green">SHORTS {shortPct.toFixed(1)}%</span>
        </div>
        <div className="ratio-bar">
          <div className="ratio-fill-long" style={{ width: `${longPct}%` }} />
          <div className="ratio-fill-short" style={{ width: `${shortPct}%` }} />
        </div>
      </div>

      {/* Price Chart */}
      <div className="chart-section-main">
        <div className="chart-header">
          <div className="chart-title-row">
            <div className="chart-symbol-select">
              {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].map(s => (
                <button
                  key={s}
                  className={`chart-sym-btn ${chartSymbol === s ? 'active' : ''}`}
                  onClick={() => setChartSymbol(s)}
                >
                  {getSymbolBase(s)}
                </button>
              ))}
            </div>
            {currentPrice && (
              <div className="chart-price-display">
                <span className="chart-current-price">
                  ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`chart-price-change ${priceChange >= 0 ? 'green' : 'red'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange?.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
          <div className="chart-interval-select">
            {['1m', '5m', '15m', '1h', '4h'].map(iv => (
              <button
                key={iv}
                className={`chart-iv-btn ${chartInterval === iv ? 'active' : ''}`}
                onClick={() => setChartInterval(iv)}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-body">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGradientUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00e676" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#00e676" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="priceGradientDown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff3b5c" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#ff3b5c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatChartTime}
                  tick={{ fill: '#555570', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                  tickLine={false}
                  minTickGap={50}
                />
                <YAxis
                  domain={[chartMin, chartMax]}
                  tick={{ fill: '#555570', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(2)}
                  width={65}
                />
                <Tooltip content={<PriceTooltip />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={priceChange >= 0 ? '#00e676' : '#ff3b5c'}
                  strokeWidth={1.5}
                  fill={priceChange >= 0 ? 'url(#priceGradientUp)' : 'url(#priceGradientDown)'}
                  dot={false}
                  activeDot={{ r: 3, fill: priceChange >= 0 ? '#00e676' : '#ff3b5c', stroke: 'none' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-loading">Loading chart...</div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="main-grid">
        {/* Live Feed */}
        <div className="feed-section">
          <div className="section-header">
            <h2>Live Feed</h2>
            <span className="feed-count">{liqs.length} recent</span>
          </div>
          <div className="feed-table-header">
            <span>Time</span>
            <span>Coin</span>
            <span>Side</span>
            <span className="right">Size</span>
            <span className="right">Price</span>
          </div>
          <div className="feed-scroll">
            {liqs.map((liq, i) => (
              <div
                key={liq.id}
                className={`feed-row ${liq.isLong ? 'long' : 'short'} ${i === 0 && connected ? 'new' : ''} ${liq.value >= 100000 ? 'whale' : ''}`}
              >
                <span className="feed-time">{formatTime(liq.time)}</span>
                <span className="feed-coin">
                  <span className="coin-icon">{COIN_ICONS[liq.symbol] || '●'}</span>
                  {liq.symbol}
                </span>
                <span className={`feed-side ${liq.isLong ? 'red' : 'green'}`}>
                  {liq.side}
                </span>
                <span className={`feed-value right ${liq.isLong ? 'red' : 'green'}`}>
                  {formatUSD(liq.value)}
                </span>
                <span className="feed-price right">
                  ${liq.price < 1 ? liq.price.toFixed(6) : liq.price < 100 ? liq.price.toFixed(2) : liq.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          {/* Coin Breakdown */}
          <div className="breakdown-section">
            <h2 className="section-header">By Coin</h2>
            {coinData.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={coinData} layout="vertical" barGap={2}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="symbol" width={45} tick={{ fill: '#8888a0', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="chart-tooltip">
                            <strong>{d.symbol}</strong>
                            <span className="red">Longs: {formatUSD(d.longs)}</span>
                            <span className="green">Shorts: {formatUSD(d.shorts)}</span>
                            <span>Total: {formatUSD(d.total)} ({d.count})</span>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="longs" stackId="a" radius={[0, 0, 0, 0]}>
                      {coinData.map((_, i) => <Cell key={i} fill="rgba(255, 59, 92, 0.7)" />)}
                    </Bar>
                    <Bar dataKey="shorts" stackId="a" radius={[0, 4, 4, 0]}>
                      {coinData.map((_, i) => <Cell key={i} fill="rgba(0, 230, 118, 0.7)" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-chart">Collecting data...</div>
            )}
          </div>

          {/* Market Prices */}
          <div className="market-section">
            <h2 className="section-header">Market</h2>
            <div className="market-list">
              {market.slice(0, 6).map(coin => (
                <div key={coin.id} className="market-row">
                  <div className="market-info">
                    <img src={coin.image} alt={coin.symbol} className="market-icon" />
                    <div>
                      <span className="market-symbol">{coin.symbol.toUpperCase()}</span>
                      <span className="market-name">{coin.name}</span>
                    </div>
                  </div>
                  <div className="market-data">
                    <span className="market-price">
                      ${coin.current_price >= 1 ? coin.current_price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : coin.current_price.toFixed(4)}
                    </span>
                    <span className={`market-change ${coin.price_change_percentage_24h >= 0 ? 'green' : 'red'}`}>
                      {coin.price_change_percentage_24h >= 0 ? '+' : ''}{coin.price_change_percentage_24h?.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
