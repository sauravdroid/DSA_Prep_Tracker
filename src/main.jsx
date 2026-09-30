import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { hydrateFromDisk } from './utils/dataFile'
import { migrateStore } from './store'
import './index.css'

// Load the on-disk data before mounting: the store is read synchronously in
// component initialisers, so hydrating afterwards would render stale state.
hydrateFromDisk()
  .then(() => migrateStore())
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
