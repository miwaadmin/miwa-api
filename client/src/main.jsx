import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Apply saved theme before first render
;(function () {
  const saved = localStorage.getItem('theme') || 'auto'
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const useDark = saved === 'dark' || (saved === 'auto' && prefersDark)
  const usePink = saved === 'pink'
  document.documentElement.classList.toggle('dark', useDark)
  document.documentElement.classList.toggle('pink', usePink)
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
