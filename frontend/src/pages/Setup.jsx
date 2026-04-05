import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api.js'

const TOTAL_STEPS = 6

function StepIndicator({ current }) {
  const labels = ['Admin', 'Webhook', 'Categories', 'Vendors', 'Storage', 'iOS']
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32, gap: 0 }}>
      {labels.map((label, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: done || active ? '#fff' : 'var(--text-secondary)',
                  border: '2px solid',
                  borderColor: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : step}
              </div>
              <span style={{ fontSize: 10, fontWeight: 500, color: active ? 'var(--accent)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                style={{
                  width: 28,
                  height: 2,
                  background: done ? 'var(--success)' : 'var(--border)',
                  margin: '0 2px',
                  marginBottom: 18,
                  flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Admin credentials ───────────────────────────────────────────────
function Step1({ data, onChange }) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Create Admin Account</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
        Set up your administrator credentials to secure the app.
      </p>
      <div className="form-group">
        <label>Username</label>
        <input
          className="input"
          placeholder="e.g. admin"
          value={data.username}
          onChange={e => onChange('username', e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <div className="form-group">
        <label>Password</label>
        <input
          type="password"
          className="input"
          placeholder="Choose a strong password"
          value={data.password}
          onChange={e => onChange('password', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Confirm Password</label>
        <input
          type="password"
          className="input"
          placeholder="Repeat your password"
          value={data.confirmPassword}
          onChange={e => onChange('confirmPassword', e.target.value)}
        />
      </div>
    </div>
  )
}

// ─── Step 2: Webhook secret ───────────────────────────────────────────────────
function Step2({ data, onChange }) {
  function generateSecret() {
    const arr = new Uint8Array(32)
    crypto.getRandomValues(arr)
    const secret = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
    onChange('webhookSecret', secret)
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Webhook Secret</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
        This secret authenticates requests from your iOS Shortcut. Keep it safe.
      </p>
      <div className="form-group">
        <label>Webhook Secret</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Enter or generate a secret"
            value={data.webhookSecret}
            onChange={e => onChange('webhookSecret', e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generateSecret}
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            Generate
          </button>
        </div>
        <p className="helper-text">Click "Generate" to create a secure random secret.</p>
      </div>
      {data.webhookSecret && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--text-primary)',
            wordBreak: 'break-all',
          }}
        >
          {data.webhookSecret}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Categories ───────────────────────────────────────────────────────
function Step3({ data, onChange }) {
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (data.categories.length === 0) {
      fetchSuggestions()
    }
  }, [])

  async function fetchSuggestions() {
    setLoading(true)
    try {
      const res = await api.get('/setup/suggest-categories')
      const cats = (res.data.categories || res.data || []).map(c => ({
        name: typeof c === 'string' ? c : c.name,
        budget: typeof c === 'object' && c.budget ? c.budget : '',
      }))
      onChange('categories', cats)
    } catch {
      // fallback defaults
      const defaults = ['Food & Dining', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Healthcare', 'Rent', 'Other']
      onChange('categories', defaults.map(name => ({ name, budget: '' })))
    } finally {
      setLoading(false)
    }
  }

  function updateCategory(index, field, value) {
    const updated = data.categories.map((c, i) => i === index ? { ...c, [field]: value } : c)
    onChange('categories', updated)
  }

  function removeCategory(index) {
    onChange('categories', data.categories.filter((_, i) => i !== index))
  }

  function addCategory() {
    const name = newName.trim()
    if (!name) return
    onChange('categories', [...data.categories, { name, budget: '' }])
    setNewName('')
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Expense Categories</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
        Define categories and set optional monthly budget limits.
      </p>

      {loading ? (
        <div className="loading-center"><div className="spinner" /><span>Loading suggestions...</span></div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <input
              className="input"
              placeholder="New category name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
            />
            <button type="button" className="btn btn-primary" onClick={addCategory} style={{ flexShrink: 0 }}>
              Add
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {data.categories.map((cat, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  value={cat.name}
                  onChange={e => updateCategory(i, 'name', e.target.value)}
                  style={{ flex: 2 }}
                />
                <input
                  className="input"
                  type="number"
                  placeholder="Budget (₹)"
                  value={cat.budget}
                  onChange={e => updateCategory(i, 'budget', e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeCategory(i)}
                  style={{ color: 'var(--danger)', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Step 4: Vendor Mappings ──────────────────────────────────────────────────
function Step4({ data, onChange }) {
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('')
  const allCategories = (data.categories || []).map(c => c.name)

  function addMapping() {
    if (!keyword.trim() || !category) return
    onChange('vendorMappings', [...data.vendorMappings, { keyword: keyword.trim(), category }])
    setKeyword('')
    setCategory('')
  }

  function removeMapping(index) {
    onChange('vendorMappings', data.vendorMappings.filter((_, i) => i !== index))
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Vendor Mappings</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
        Map keywords in transaction descriptions to categories automatically.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Keyword (e.g. SWIGGY)"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ flex: '1 1 140px' }}
          onKeyDown={e => e.key === 'Enter' && addMapping()}
        />
        <select
          className="select"
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ flex: '1 1 140px' }}
        >
          <option value="">Select category</option>
          {allCategories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={addMapping} style={{ flexShrink: 0 }}>
          Add
        </button>
      </div>

      {data.vendorMappings.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <p>No mappings yet. Add keyword → category rules above.</p>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 0 }}>
            <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>Keyword</div>
            <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>Category</div>
            <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }} />
            {data.vendorMappings.map((m, i) => (
              <>
                <div key={`k-${i}`} style={{ padding: '10px 12px', borderBottom: i < data.vendorMappings.length - 1 ? '1px solid var(--border)' : 'none', fontFamily: 'monospace', fontSize: 13 }}>{m.keyword}</div>
                <div key={`c-${i}`} style={{ padding: '10px 12px', borderBottom: i < data.vendorMappings.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>{m.category}</div>
                <div key={`a-${i}`} style={{ padding: '6px 8px', borderBottom: i < data.vendorMappings.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeMapping(i)} style={{ color: 'var(--danger)' }}>✕</button>
                </div>
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 5: Storage path ─────────────────────────────────────────────────────
function Step5({ data, onChange }) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Storage Path</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
        Where should the app store expense files and data on the server?
      </p>
      <div className="form-group">
        <label>Storage Directory</label>
        <input
          className="input"
          placeholder="~/finance-app/storage/"
          value={data.storagePath}
          onChange={e => onChange('storagePath', e.target.value)}
          style={{ fontFamily: 'monospace' }}
        />
        <p className="helper-text">
          Default: <code style={{ fontSize: 12 }}>~/finance-app/storage/</code>. The directory will be created if it doesn't exist.
        </p>
      </div>
    </div>
  )
}

// ─── Step 6: iOS Shortcut instructions ───────────────────────────────────────
function Step6({ webhookSecret }) {
  const baseUrl = window.location.origin

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>iPhone Shortcut Setup</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
        Set up an iOS Shortcut to automatically send bank SMS/alerts to this app.
      </p>

      <ol style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 0, listStyle: 'none' }}>
        {[
          {
            n: 1,
            title: 'Open the Shortcuts app on your iPhone',
            desc: 'Available by default on iOS 13+. Search "Shortcuts" in Spotlight if you can\'t find it.',
          },
          {
            n: 2,
            title: 'Create a new Automation',
            desc: 'Tap "Automation" at the bottom, then tap the "+" button. Choose "Message" as the trigger. Set "Message Contains" filter to match your bank name (e.g. "HDFC", "SBI").',
          },
          {
            n: 3,
            title: 'Add a "Get Contents of URL" action',
            desc: (
              <>
                Set the URL to:{' '}
                <code
                  style={{
                    display: 'block',
                    marginTop: 6,
                    padding: '6px 10px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  {baseUrl}/webhook/sms
                </code>
              </>
            ),
          },
          {
            n: 4,
            title: 'Configure the request',
            desc: (
              <>
                <p>Method: <strong>POST</strong></p>
                <p style={{ marginTop: 4 }}>Headers: Add <code>X-Webhook-Secret</code> =</p>
                <code
                  style={{
                    display: 'block',
                    marginTop: 4,
                    padding: '6px 10px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  {webhookSecret || '<your-webhook-secret>'}
                </code>
                <p style={{ marginTop: 8 }}>Body (JSON):</p>
                <pre
                  style={{
                    marginTop: 4,
                    padding: '8px 10px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    overflow: 'auto',
                  }}
                >{`{
  "text": "<Shortcut Variable: Message Content>",
  "sender": "<Shortcut Variable: Sender Name>"
}`}</pre>
              </>
            ),
          },
          {
            n: 5,
            title: 'Test & Save the Shortcut',
            desc: 'Run the shortcut manually once with a sample SMS to verify it sends data correctly. Check the Transactions page to see if it appeared.',
          },
        ].map(step => (
          <li key={step.n} style={{ display: 'flex', gap: 14 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {step.n}
            </div>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{step.title}</p>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{step.desc}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── Main Setup Component ─────────────────────────────────────────────────────
export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    webhookSecret: '',
    categories: [],
    vendorMappings: [],
    storagePath: '~/finance-app/storage/',
  })

  function updateField(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  function validate() {
    setError('')
    if (step === 1) {
      if (!formData.username.trim()) return setError('Username is required.') || false
      if (formData.password.length < 6) return setError('Password must be at least 6 characters.') || false
      if (formData.password !== formData.confirmPassword) return setError('Passwords do not match.') || false
    }
    if (step === 2) {
      if (!formData.webhookSecret.trim()) return setError('Webhook secret is required.') || false
    }
    if (step === 3) {
      if (formData.categories.length === 0) return setError('Add at least one category.') || false
    }
    if (step === 5) {
      if (!formData.storagePath.trim()) return setError('Storage path is required.') || false
    }
    return true
  }

  function handleNext() {
    if (!validate()) return
    if (step < TOTAL_STEPS) setStep(s => s + 1)
  }

  function handleBack() {
    if (step > 1) setStep(s => s - 1)
  }

  async function handleComplete() {
    if (!validate()) return
    setSubmitting(true)
    setError('')
    try {
      await api.post('/setup/complete', {
        username: formData.username,
        password: formData.password,
        webhook_secret: formData.webhookSecret,
        categories: formData.categories.map(c => ({
          name: c.name,
          monthly_budget: c.budget ? parseFloat(c.budget) : null,
        })),
        vendor_mappings: formData.vendorMappings,
        storage_path: formData.storagePath,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Setup failed. Please try again.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Setup Complete!</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Redirecting to login...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Finance App Setup</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Step {step} of {TOTAL_STEPS}
          </p>
        </div>

        <StepIndicator current={step} />

        <div className="card" style={{ padding: '28px' }}>
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 20 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {step === 1 && <Step1 data={formData} onChange={updateField} />}
          {step === 2 && <Step2 data={formData} onChange={updateField} />}
          {step === 3 && <Step3 data={formData} onChange={updateField} />}
          {step === 4 && <Step4 data={formData} onChange={updateField} />}
          {step === 5 && <Step5 data={formData} onChange={updateField} />}
          {step === 6 && <Step6 webhookSecret={formData.webhookSecret} />}

          {/* Footer buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleBack}
              disabled={step === 1}
            >
              ← Back
            </button>

            {step < TOTAL_STEPS ? (
              <button type="button" className="btn btn-primary" onClick={handleNext}>
                Next →
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleComplete}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)', width: 14, height: 14 }} />
                    Finishing...
                  </>
                ) : (
                  'Complete Setup'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
