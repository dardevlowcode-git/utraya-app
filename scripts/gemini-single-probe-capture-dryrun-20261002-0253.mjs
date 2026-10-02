// Dry-run offline del response capture per la mono-prova Gemini 2026-10-02-0253.
// Replica la semantica di captureProbedResponse (status/header/body in memoria,
// body troncato al cap con flag) contro un endpoint locale finto con tre casi:
// risposta normale, risposta lenta, body troncato. Nessuna chiamata live, nessun segreto.
import http from 'node:http'

const CAP_BYTES = 1_000_000

async function captureProbedResponse(response) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const fullText = await response.text()
  const truncated = Buffer.byteLength(fullText, 'utf8') > CAP_BYTES
  let bodyText = fullText
  if (truncated) {
    let bytes = 0
    let cut = 0
    for (const char of fullText) {
      bytes += Buffer.byteLength(char, 'utf8')
      if (bytes > CAP_BYTES) break
      cut += char.length
    }
    bodyText = fullText.slice(0, cut)
  }
  return { status: response.status, headers, bodyText, truncated }
}

const server = http.createServer((req, res) => {
  if (req.url === '/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-probe-case': 'slow' })
      res.end(JSON.stringify({ ok: true, slow: true }))
    }, 1500)
    return
  }
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain', 'x-probe-case': 'big' })
    res.end('x'.repeat(CAP_BYTES + 100))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json', 'x-probe-case': 'ok' })
  res.end(JSON.stringify({ ok: true, data: { analysisId: '00000000-0000-4000-8000-000000000000' } }))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const evidence = []
for (const path of ['/', '/slow', '/big']) {
  const started = Date.now()
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  const captured = await captureProbedResponse(response)
  evidence.push({
    case: path,
    elapsedMs: Date.now() - started,
    status: captured.status,
    headerProbeCase: captured.headers['x-probe-case'],
    headerContentType: captured.headers['content-type'],
    bodyBytes: Buffer.byteLength(captured.bodyText, 'utf8'),
    bodyPreview: captured.bodyText.slice(0, 80),
    truncated: captured.truncated,
  })
}
server.close()

let failed = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)
  if (!cond) failed += 1
}
const [ok, slow, big] = evidence
check('ok: status 200 catturato', ok.status === 200)
check('ok: header x-probe-case catturato', ok.headerProbeCase === 'ok')
check('ok: body catturato in memoria', ok.bodyPreview.includes('"ok":true'))
check('ok: non troncato', ok.truncated === false)
check('slow: status 200 dopo ~1.5s senza perdere body', slow.status === 200 && slow.bodyPreview.includes('"slow":true') && slow.elapsedMs >= 1400)
check('slow: header catturato', slow.headerProbeCase === 'slow')
check('big: body troncato segnalato', big.truncated === true && big.bodyBytes <= CAP_BYTES)
check('big: status e header comunque catturati', big.status === 200 && big.headerProbeCase === 'big')
console.log(JSON.stringify(evidence, null, 2))
process.exit(failed === 0 ? 0 : 1)
