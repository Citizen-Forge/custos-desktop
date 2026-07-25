import type { CustosApi } from './index'

declare global {
  interface Window {
    custos: CustosApi
  }
}
