#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const targetDirs = ['src', 'supabase/migrations']
const extensions = new Set(['.ts', '.tsx', '.js', '.css', '.sql'])
const requiredHeaderByExt = {
  '.sql': '-- Commento didattico:',
  default: '/* Commento didattico:',
}
const rootFiles = ['next.config.mjs', 'postcss.config.js', 'tailwind.config.ts']

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    out.push(full)
  }
  return out
}

const files = targetDirs.flatMap((d) => walk(path.join(projectRoot, d)))
for (const file of rootFiles) {
  const fullPath = path.join(projectRoot, file)
  if (fs.existsSync(fullPath)) {
    files.push(fullPath)
  }
}

const missing = []
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  const ext = path.extname(file)
  const requiredHeader = requiredHeaderByExt[ext] ?? requiredHeaderByExt.default
  if (!content.startsWith(requiredHeader)) {
    missing.push(path.relative(projectRoot, file))
  }
}

if (missing.length > 0) {
  console.error('File senza commento didattico iniziale:')
  for (const file of missing) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}

console.log(`Controllo commenti superato: ${files.length} file verificati.`)
