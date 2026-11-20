export function networkColor(id: string) {
  let hash = 0
  for (const character of id)
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  return `hsl(${Math.abs(hash) % 360} 65% 39%)`
}
