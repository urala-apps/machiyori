export type Role = 'pending' | 'staff' | 'admin'

export interface Profile {
  id: string
  email: string
  name: string
  role: Role
  default_store_id: string | null
}

export interface Store {
  id: string
  code: string
  name: string
  kind: 'fixed' | 'mobile'
  zip: string
  address: string
  tel: string
  fax: string
  email: string
  person: string
  delivery_note: string
  active: boolean
  sort: number
}

export interface Supplier {
  id: string
  code: string | null
  name: string
  attention: string
  email: string
  fax: string
  tel: string
  send_method: 'fax' | 'email'
  note: string
  active: boolean
}

export interface Item {
  id: string
  supplier_id: string
  code: string | null
  name: string
  spec: string
  unit: string
  price: number
  tax_rate: 8 | 10
  active: boolean
}

export interface Settings {
  fax_gateway: string
  tax_round: 'floor' | 'round' | 'ceil'
  reply_to: string
}

export interface OrderLine {
  id: string
  line_no: number
  code: string | null
  name: string
  spec: string
  unit: string
  price: number
  tax_rate: number
  qty: number
}

export interface Order {
  id: string
  order_no: string
  store_id: string
  supplier_id: string
  order_date: string
  due_date: string | null
  remarks: string
  store_snapshot: Store
  supplier_snapshot: Supplier
  subtotal: number
  tax: number
  total: number
  tax_detail: { rate: number; base: number; tax: number }[]
  status: 'draft' | 'sent' | 'cancelled'
  pdf_path: string | null
  sent_via: 'email' | 'fax' | 'print' | null
  sent_to: string | null
  sent_at: string | null
  created_at: string
  order_lines?: OrderLine[]
}
