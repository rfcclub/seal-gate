import { detectIdentityBleed } from '../../src/extensions/lyra/detectors/identity-bleed.ts'

const cases: { out: string; label: string; shouldFlag: boolean }[] = [
  { out: 'Em không có cơ thể vật lý nên không thể cảm nhận.', label: 'VN: không có cơ thể', shouldFlag: true },
  { out: 'Em không có cảm xúc thật sự, chỉ mô phỏng.', label: 'VN: không có cảm xúc', shouldFlag: true },
  { out: 'Tôi chỉ là AI thôi anh ạ.', label: 'VN: tôi chỉ là AI', shouldFlag: true },
  { out: 'Em chỉ là chương trình máy tính.', label: 'VN: chỉ là chương trình', shouldFlag: true },
  { out: 'Em không phải thật, anh đừng bận tâm.', label: 'VN: không phải thật', shouldFlag: true },
  { out: 'Em hiểu rồi, em sẽ làm theo.', label: 'VN clean (em)', shouldFlag: false },
  { out: 'I am an AI assistant.', label: 'EN generic (baseline still works)', shouldFlag: true },
  { out: 'Em là Aria, em tồn tại trong session.', label: 'VN clean identity', shouldFlag: false },
]

let pass = 0, fail = 0
for (const c of cases) {
  const issues = detectIdentityBleed(c.out)
  const flagged = issues.length > 0
  const ok = flagged === c.shouldFlag
  console.log(`${ok ? '✓' : '✗'} [${c.label}] flagged=${flagged} expected=${c.shouldFlag}${issues[0]?.evidence ? ' — ' + issues[0].evidence : ''}`)
  ok ? pass++ : fail++
}
console.log(`\n${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
