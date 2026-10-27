declare module 'html2pdf.js' {
  interface Worker {
    set(options: Record<string, unknown>): Worker
    from(el: HTMLElement): Worker
    outputPdf(type: 'blob'): Promise<Blob>
    save(filename?: string): Promise<void>
  }
  export default function html2pdf(): Worker
}
