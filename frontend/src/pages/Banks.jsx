import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import api from '../api.js'

const BANK_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6']

function fmt(n) {
  const abs = Math.abs(n ?? 0)
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${Number(n ?? 0).toFixed(0)}`
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 13, color: p.color, margin: '2px 0' }}>
          {p.name}: ₹{Number(p.value).toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

export default function Banks() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/expenses/banks')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load bank data.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span>Loading bank data...</span>
      </div>
    )
  }

  if (error) return <div className="alert alert-danger">{error}</div>

  const hasAny = data?.banks?.length || data?.credit_cards?.length
  if (!hasAny) {
    return (
      <div className="empty-state" style={{ marginTop: 60 }}>
        <div className="empty-state-icon">🏦</div>
        <h3>No bank data yet</h3>
        <p>Upload transactions that include bank information to see your bank overview.</p>
      </div>
    )
  }

  const { banks = [], credit_cards = [], cumulative_balance, bank_names = [] } = data

  function AccountCard({ account, i, isCC }) {
    const color = BANK_COLORS[i % BANK_COLORS.length]
    const isPositive = account.net_flow >= 0
    const stats = isCC
      ? [
          { label: 'Charges', value: account.total_out, color: 'var(--danger)' },
          { label: 'Payments', value: account.total_in, color: 'var(--success)' },
          { label: 'Outstanding', value: account.outstanding, color: account.outstanding > 0 ? 'var(--danger)' : 'var(--success)' },
        ]
      : [
          { label: 'Total In', value: account.total_in, color: 'var(--success)' },
          { label: 'Total Out', value: account.total_out, color: 'var(--danger)' },
          { label: 'Net Flow', value: account.net_flow, color: isPositive ? 'var(--success)' : 'var(--danger)' },
        ]
    return (
      <div className="card" style={{ borderTop: `3px solid ${color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>{isCC ? '💳' : '🏦'}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
              {account.display_name || account.name}
            </div>
            {account.accounts.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {account.accounts.map(a => `••••${a}`).join('  ·  ')}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          {stats.map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: '10px 6px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{fmt(s.value)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>{account.transaction_count} transactions</span>
          <span>Last: {account.last_activity}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Bank accounts */}
      {banks.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Bank Accounts
          </div>
          <div className="stats-grid" style={{ marginBottom: 28 }}>
            {banks.map((bank, i) => <AccountCard key={bank.name} account={bank} i={i} isCC={false} />)}
          </div>
        </>
      )}

      {/* Credit cards */}
      {credit_cards.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Credit Cards
          </div>
          <div className="stats-grid" style={{ marginBottom: 28 }}>
            {credit_cards.map((card, i) => <AccountCard key={card.name} account={card} i={banks.length + i} isCC={true} />)}
          </div>
        </>
      )}

      {/* Cumulative net-flow chart */}
      {cumulative_balance.length > 1 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title">Cumulative Net Flow</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, marginTop: -8 }}>
            Running total of credits minus debits since your first recorded transaction
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={cumulative_balance} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={d => {
                  const dt = new Date(d)
                  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={v => fmt(v)}
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={v => <span style={{ fontSize: 12 }}>{v}</span>} />
              {bank_names.map((b, i) => (
                <Line
                  key={b}
                  type="monotone"
                  dataKey={b}
                  name={b}
                  stroke={BANK_COLORS[i % BANK_COLORS.length]}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly cash flow charts */}
      {[...banks, ...credit_cards].map((account, i) => {
        if (account.monthly_flow.length < 2) return null
        const color = BANK_COLORS[i % BANK_COLORS.length]
        const isCC = account.kind === 'credit_card'
        return (
          <div key={account.name} className="card" style={{ marginBottom: 20 }}>
            <div className="section-title">
              {account.display_name || account.name} — Monthly Cash Flow
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={account.monthly_flow} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} tickFormatter={v => fmt(v)} width={60} />
                <Tooltip content={<CustomTooltip />} />
                <Legend formatter={v => <span style={{ fontSize: 12 }}>{v}</span>} />
                <Bar dataKey="in" name={isCC ? 'Payments' : 'Credits'} fill="#22C55E" radius={[3, 3, 0, 0]} />
                <Bar dataKey="out" name={isCC ? 'Charges' : 'Debits'} fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}
