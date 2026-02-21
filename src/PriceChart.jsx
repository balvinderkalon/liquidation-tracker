import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

const BINANCE_API = 'https://fapi.binance.com'

function getSymbolBase(symbol) {
  return symbol.replace(/USDT$|BUSD$|USD$/, '')
}

export default function PriceChart() {
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const wsRef = useRef(null)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval_] = useState('5m')
  const [currentPrice, setCurrentPrice] = useState(null)
  const [priceChange, setPriceChange] = useState(null)
  const [high24h, setHigh24h] = useState(null)
  const [low24h, setLow24h] = useState(null)

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555570',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.025)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.025)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.1)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1a1a2a',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.1)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1a1a2a',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.05)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.05)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00e676',
      downColor: '#ff3b5c',
      borderUpColor: '#00e676',
      borderDownColor: '#ff3b5c',
      wickUpColor: '#00e67688',
      wickDownColor: '#ff3b5c88',
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Fetch data when symbol/interval changes
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=300`)
      const data = await res.json()
      if (!Array.isArray(data)) return

      const candles = data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }))

      const volumes = data.map(k => ({
        time: Math.floor(k[0] / 1000),
        value: parseFloat(k[5]),
        color: parseFloat(k[4]) >= parseFloat(k[1])
          ? 'rgba(0, 230, 118, 0.15)'
          : 'rgba(255, 59, 92, 0.15)',
      }))

      if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(candles)
      }
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(volumes)
      }

      if (candles.length > 0) {
        const latest = candles[candles.length - 1]
        const first = candles[0]
        setCurrentPrice(latest.close)
        setPriceChange(((latest.close - first.open) / first.open) * 100)

        // 24h high/low from visible data
        const highs = candles.map(c => c.high)
        const lows = candles.map(c => c.low)
        setHigh24h(Math.max(...highs))
        setLow24h(Math.min(...lows))
      }

      // Scroll to latest
      if (chartRef.current) {
        chartRef.current.timeScale().scrollToRealTime()
      }
    } catch (e) {
      console.error('Chart fetch error:', e)
    }
  }, [symbol, interval])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // WebSocket for real-time candle updates
  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const k = msg.k
        if (!k) return

        const candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        }

        const volume = {
          time: Math.floor(k.t / 1000),
          value: parseFloat(k.v),
          color: candle.close >= candle.open
            ? 'rgba(0, 230, 118, 0.15)'
            : 'rgba(255, 59, 92, 0.15)',
        }

        if (candleSeriesRef.current) {
          candleSeriesRef.current.update(candle)
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update(volume)
        }

        setCurrentPrice(candle.close)
      } catch (e) {}
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [symbol, interval])

  const base = getSymbolBase(symbol)

  return (
    <div className="chart-section-main">
      <div className="chart-header">
        <div className="chart-title-row">
          <div className="chart-symbol-select">
            {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'].map(s => (
              <button
                key={s}
                className={`chart-sym-btn ${symbol === s ? 'active' : ''}`}
                onClick={() => setSymbol(s)}
              >
                {getSymbolBase(s)}
              </button>
            ))}
          </div>
          {currentPrice && (
            <div className="chart-price-display">
              <span className="chart-current-price">
                ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: currentPrice < 1 ? 6 : 2 })}
              </span>
              <span className={`chart-price-change ${priceChange >= 0 ? 'green' : 'red'}`}>
                {priceChange >= 0 ? '+' : ''}{priceChange?.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
        <div className="chart-controls-right">
          {high24h && low24h && (
            <div className="chart-hl">
              <span className="hl-label">H</span>
              <span className="hl-val green">${high24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className="hl-label">L</span>
              <span className="hl-val red">${low24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="chart-interval-select">
            {['1m', '5m', '15m', '1h', '4h', '1d'].map(iv => (
              <button
                key={iv}
                className={`chart-iv-btn ${interval === iv ? 'active' : ''}`}
                onClick={() => setInterval_(iv)}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-body" ref={chartContainerRef} />
    </div>
  )
}
