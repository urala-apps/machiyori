import { createContext, useContext, useEffect, useState } from 'react'
import type { Profile, Settings, Store, Supplier } from './types'

export interface AppData {
  profile: Profile
  stores: Store[]
  suppliers: Supplier[]
  settings: Settings
  isAdmin: boolean
  reload: () => Promise<void>
  toast: (msg: string) => void
}

export const AppContext = createContext<AppData | null>(null)

export function useApp() {
  const v = useContext(AppContext)
  if (!v) throw new Error('AppContext がありません')
  return v
}

/** #/sheets/abc のようなハッシュを ['sheets', 'abc'] にする */
export function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (path: string) => { location.hash = '#/' + path }
