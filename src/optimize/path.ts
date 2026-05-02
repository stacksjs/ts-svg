/**
 * SVG path data parsing/stringification per https://www.w3.org/TR/SVG11/paths.html#PathDataBNF.
 *
 * Differences vs. ts-svg's own `path.ts` (which is shape-rasterisation-oriented):
 *  - Preserves command/argument structure (M/L/C/etc.) for round-trip optimisation.
 *  - Provides `stringifyPathData` that matches SVGO's compact output format.
 */

import type { PathDataCommand, PathDataItem } from './types'
import { removeLeadingZero, toFixed } from './tools'

const argsCountPerCommand: Record<string, number> = {
  M: 2,
  m: 2,
  Z: 0,
  z: 0,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  A: 7,
  a: 7,
}

function isCommand(c: string): c is PathDataCommand {
  return c in argsCountPerCommand
}

function isWhiteSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n'
}

function isDigit(c: string): boolean {
  const code = c.charCodeAt(0)
  return code >= 48 && code <= 57
}

/**
 * Read a single SVG path number starting at `cursor`. Returns
 * `[lastIndexConsumed, value]` or `[cursor, null]` if the input is malformed.
 *
 * Hot path: char-code-driven boundary detection then a single
 * `parseFloat(slice)` — much cheaper than the original char-by-char
 * `value += c` loop, which created a new string per character.
 */
function readNumber(string: string, cursor: number): [number, number | null] {
  const len = string.length
  let i = cursor
  // Optional sign
  if (i < len) {
    const c = string.charCodeAt(i)
    if (c === 43 /* + */ || c === 45 /* - */) i++
  }
  let sawDigit = false
  let sawDot = false
  while (i < len) {
    const c = string.charCodeAt(i)
    if (c >= 48 && c <= 57) { sawDigit = true; i++ }
    else if (c === 46 /* . */ && !sawDot) { sawDot = true; i++ }
    else break
  }
  // Exponent
  if (sawDigit && i < len) {
    const c = string.charCodeAt(i)
    if (c === 101 /* e */ || c === 69 /* E */) {
      const expStart = i
      i++
      if (i < len) {
        const sc = string.charCodeAt(i)
        if (sc === 43 || sc === 45) i++
      }
      let sawExpDigit = false
      while (i < len) {
        const c2 = string.charCodeAt(i)
        if (c2 >= 48 && c2 <= 57) { sawExpDigit = true; i++ }
        else break
      }
      // Roll back if exponent had no digits — `1e` is invalid by spec.
      if (!sawExpDigit) i = expStart
    }
  }
  if (!sawDigit) return [cursor, null]
  const num = Number.parseFloat(string.slice(cursor, i))
  if (Number.isNaN(num)) return [cursor, null]
  return [i - 1, num]
}

export function parsePathData(string: string): PathDataItem[] {
  const pathData: PathDataItem[] = []
  let command: PathDataCommand | null = null
  let args: number[] = []
  let argsCount = 0
  let canHaveComma = false
  let hadComma = false
  for (let i = 0; i < string.length; i++) {
    const c = string.charAt(i)
    if (isWhiteSpace(c))
      continue

    if (canHaveComma && c === ',') {
      if (hadComma)
        break
      hadComma = true
      continue
    }
    if (isCommand(c)) {
      if (hadComma)
        return pathData
      if (command == null) {
        if (c !== 'M' && c !== 'm')
          return pathData
      }
      else if (args.length !== 0) {
        return pathData
      }
      command = c
      args = []
      argsCount = argsCountPerCommand[command]!
      canHaveComma = false
      if (argsCount === 0)
        pathData.push({ command, args })
      continue
    }
    if (command == null)
      return pathData

    // Use direct assignment instead of destructuring — pickier's
    // prefer-const rule doesn't recognise destructuring targets as
    // reassignments and would otherwise rewrite this `let` to `const`.
    let newCursor = i
    let number: number | null = null
    if (command === 'A' || command === 'a') {
      const position = args.length
      if (position === 0 || position === 1 || position === 2 || position === 5 || position === 6) {
        const r = readNumber(string, i)
        newCursor = r[0]
        number = r[1]
      }
      if (position === 3 || position === 4) {
        if (c === '0')
          number = 0
        if (c === '1')
          number = 1
      }
    }
    else {
      const r = readNumber(string, i)
      newCursor = r[0]
      number = r[1]
    }
    if (number == null)
      return pathData

    args.push(number)
    canHaveComma = true
    hadComma = false
    i = newCursor

    if (args.length === argsCount) {
      if (command === 'A' || command === 'a') {
        args[0] = Math.abs(args[0]!)
        args[1] = Math.abs(args[1]!)
      }
      pathData.push({ command, args })
      // implicit lineto after moveto
      if (command === 'M')
        command = 'L'
      if (command === 'm')
        command = 'l'
      args = []
    }
  }
  return pathData
}

function stringifyArgs(
  command: string,
  args: ReadonlyArray<number>,
  precision: number | undefined,
  disableSpaceAfterFlags: boolean | undefined,
): string {
  // Inline `roundAndStringify` to avoid allocating a 2-field object per
  // path argument. Hot path: stringifying a path with thousands of segs.
  const isArc = (command === 'A' || command === 'a')
  const noSpaceAfterFlags = !!disableSpaceAfterFlags && isArc
  let result = ''
  let previous: number | undefined
  const len = args.length
  for (let i = 0; i < len; i++) {
    let num = args[i]!
    if (precision != null) num = toFixed(num, precision)
    const roundedStr = removeLeadingZero(num)
    if (noSpaceAfterFlags) {
      const pos = i % 7
      if (pos === 4 || pos === 5) { result += roundedStr; previous = num; continue }
    }
    if (i === 0 || num < 0) {
      result += roundedStr
    }
    else if (previous !== undefined && !Number.isInteger(previous)) {
      // The previous arg ended in a decimal (its `.x` runs to the end), so
      // we can elide the separator iff the new arg doesn't begin with a
      // digit (i.e. starts with a sign or `.`). `roundedStr.charCodeAt(0)`
      // is the first byte; check whether it's a digit (48–57).
      const c = roundedStr.charCodeAt(0)
      if (c < 48 || c > 57) result += roundedStr
      else result += ` ${roundedStr}`
    }
    else {
      result += ` ${roundedStr}`
    }
    previous = num
  }
  return result
}

export interface StringifyPathDataOptions {
  pathData: ReadonlyArray<PathDataItem>
  precision?: number
  disableSpaceAfterFlags?: boolean
}

export function stringifyPathData({ pathData, precision, disableSpaceAfterFlags }: StringifyPathDataOptions): string {
  if (pathData.length === 1) {
    const { command, args } = pathData[0]!
    return command + stringifyArgs(command, args, precision, disableSpaceAfterFlags)
  }

  let result = ''
  let prev: PathDataItem = { ...pathData[0]! }

  if (pathData[1]!.command === 'L')
    prev.command = 'M'
  else if (pathData[1]!.command === 'l')
    prev.command = 'm'

  for (let i = 1; i < pathData.length; i++) {
    const { command, args } = pathData[i]!
    if (
      (prev.command === command && prev.command !== 'M' && prev.command !== 'm')
      || (prev.command === 'M' && command === 'L')
      || (prev.command === 'm' && command === 'l')
    ) {
      prev.args = [...prev.args, ...args]
      if (i === pathData.length - 1) {
        result += prev.command + stringifyArgs(prev.command, prev.args, precision, disableSpaceAfterFlags)
      }
    }
    else {
      result += prev.command + stringifyArgs(prev.command, prev.args, precision, disableSpaceAfterFlags)
      if (i === pathData.length - 1)
        result += command + stringifyArgs(command, args, precision, disableSpaceAfterFlags)
      else
        prev = { command, args }
    }
  }
  return result
}
