import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { applyTheme, readTheme } from './theme'

applyTheme(readTheme())
createApp(App).mount('#app')
