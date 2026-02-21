import { useState, useEffect, useRef, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import './App.css'

const WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr'
const COINGECKO_URL = 'https://api.coingecko.com/api/v3'
const MAX_LIQS = 200
const COIN_ICONS = { BTC: '₿', ETH: 'Ξ', SOL: '◎', BNB: '◆', XRP: '✕', DOGE: 'Ð', ADA: '₳', AVAX: 'A', DOT: '●', MATIC: 'M', LINK: '⬡', ARB: 'A', OP: 'O', SUI: 'S', APT: 'A' }

function formatUSD(val) {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function getSymbolBase(symbol) {
  return symbol.replace(/USDT$|BUSD$|USD$/, '')
}

export default function App() {
  const [liqs, setLiqs] = useState([])
  const [connected, setConnected] = useState(false)
  const [market, setMarket] = useState([])
  const [stats, setStats] = useState({ totalLongs: 0, totalShorts: 0, count: 0, largest: null })
  const [timeFilter, setTimeFilter] = useState('all')
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const statsRef = useRef(stats)
  const liqsRef = useRef(liqs)

  // Keep refs in sync
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { liqsRef.current = liqs }, [liqs])

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

    ws.onopen = () => {
      setConnected(true)
      console.log('WS connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const order = msg.o
        if (!order) return

        const symbol = getSymbolBase(order.s)
        const side = order.S // BUY = short liq, SELL = long liq
        const isLong = side === 'SELL'
        const price = parseFloat(order.p)
        const qty = parseFloat(order.q)
        const value = price * qty
        const time = msg.E

        if (value < 100) return // filter dust

        const liq = {
          id: `${time}-${order.s}-${Math.random()}`,
          symbol,
          fullSymbol: order.s,
          side: isLong ? 'LONG' : 'SHORT',
          isLong,
          price,
          qty,
          value,
          time,
        }

        setLiqs(prev => {
          const next = [liq, ...prev].slice(0, MAX_LIQS)
          return next
        })

        setStats(prev => {
          const newStats = {
            ...prev,
            count: prev.count + 1,
            totalLongs: prev.totalLongs + (isLong ? value : 0),
            totalShorts: prev.totalShorts + (isLong ? 0 : value),
          }
          if (!prev.largest || value > prev.largest.value) {
            newStats.largest = liq
          }
          return newStats
        })
      } catch (e) { console.error('Parse error:', e) }
    }

    ws.onclose = () => {
      setConnected(false)
      reconnectRef.current = setTimeout(connectWS, 3000)
    }

    ws.onerror = () => { ws.close() }
  }, [])

  useEffect(() => {
    connectWS()
    return () => {
      wsRef.current?.close()
      clearTimeout(reconnectRef.current)
    }
  }, [connectWS])

  // Derived data
  const totalLiquidated = stats.totalLongs + stats.totalShorts
  const longPct = totalLiquidated > 0 ? (stats.totalLongs / totalLiquidated) * 100 : 50
  const shortPct = 100 - longPct

  // Coin breakdown
  const coinBreakdown = liqs.reduce((acc, l) => {
    if (!acc[l.symbol]) acc[l.symbol] = { symbol: l.symbol, longs: 0, shorts: 0, total: 0, count: 0 }
    acc[l.symbol].total += l.value
    acc[l.symbol].count += 1
    if (l.isLong) acc[l.symbol].longs += l.value
    else acc[l.symbol].shorts += l.value
    return acc
  }, {})

  const coinData = Object.values(coinBreakdown)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

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
            {liqs.length === 0 ? (
              <div className="feed-empty">
                <span className="feed-empty-icon">⚡</span>
                <span>Waiting for liquidations...</span>
                <span className="feed-empty-sub">Real-time data from Binance Futures</span>
              </div>
            ) : (
              liqs.map((liq, i) => (
                <div
                  key={liq.id}
                  className={`feed-row ${liq.isLong ? 'long' : 'short'} ${i === 0 ? 'new' : ''} ${liq.value >= 100000 ? 'whale' : ''}`}
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
                    ${liq.price < 1 ? liq.price.toFixed(4) : liq.price < 100 ? liq.price.toFixed(2) : liq.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          {/* Coin Breakdown */}
          <div className="breakdown-section">
            <h2 className="section-header">By Coin</h2>
            {coinData.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={coinData} layout="vertical" barGap={2}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="symbol" width={45} tick={{ fill: '#8888a0', fontSize: 12, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="chart-tooltip">
                            <strong>{d.symbol}</strong>
                            <span className="red">Longs: {formatUSD(d.longs)}</span>
                            <span className="green">Shorts: {formatUSD(d.shorts)}</span>
                            <span>Total: {formatUSD(d.total)} ({d.count} events)</span>
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
