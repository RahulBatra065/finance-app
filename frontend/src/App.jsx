import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Investments from './pages/Investments.jsx'
import Transactions from './pages/Transactions.jsx'
import Banks from './pages/Banks.jsx'
import CreditCards from './pages/CreditCards.jsx'
import Settings from './pages/Settings.jsx'
import Setup from './pages/Setup.jsx'
import Upload from './pages/Upload.jsx'
import Layout from './components/Layout.jsx'

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token')
  return token ? children : <Navigate to="/login" />
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout theme={theme} setTheme={setTheme} />
            </PrivateRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="investments" element={<Investments />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="banks" element={<Banks />} />
          <Route path="credit-cards" element={<CreditCards />} />
          <Route path="settings" element={<Settings />} />
          <Route path="upload" element={<Upload />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
