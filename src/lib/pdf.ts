// 発注書（A4 の DOM）を PDF にする。FAX でも読めるよう 2 倍の解像度で画像にする
export async function sheetPdf(el: HTMLElement): Promise<Blob> {
  const { default: html2pdf } = await import('html2pdf.js')  // 重いので使うときに読む
  // html2pdf の Worker は Promise としてふるまうので、async 関数から返さずにここで最後まで呼ぶ
  return html2pdf().set({
    margin: 0,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: 'avoid-all' },
  }).from(el).outputPdf('blob')
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
