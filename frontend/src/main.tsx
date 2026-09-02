import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import { App } from '@app/App'
import '@app/styles/global.css'

axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL || '/'
axios.defaults.withCredentials = true

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
