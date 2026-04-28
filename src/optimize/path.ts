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

type ReadNumberState
  = | 'none'
    | 'sign'
    | 'whole'
    | 'decimal_point'
    | 'decimal'
    | 'e'
    | 'exponent_sign'
    | 'exponent'

function readNumber(string: string, cursor: number): [number, number | null] {
  let i = cursor
  let value = ''
  let state: ReadNumberState = 'none'
  for (; i < string.length; i++) {
    const c = string[i]!
    if (c === '+' || c === '-') {
      if (state === 'none') {
        state = 'sign'
        value += c
        continue
      }
      if (state === 'e') {
        state = 'exponent_sign'
        value += c
        continue
      }
    }
    if (isDigit(c)) {
      if (state === 'none' || state === 'sign' || state === 'whole') {
        state = 'whole'
        value += c
        continue
      }
      if (state === 'decimal_point' || state === 'decimal') {
        state = 'decimal'
        value += c
        continue
      }
      if (state === 'e' || state === 'exponent_sign' || state === 'exponent') {
        state = 'exponent'
        value += c
        continue
      }
    }
    if (c === '.') {
      if (state === 'none' || state === 'sign' || state === 'whole') {
        state = 'decimal_point'
        value += c
        continue
      }
    }
    if (c === 'E' || c === 'e') {
      if (state === 'whole' || state === 'decimal_point' || state === 'decimal') {
        state = 'e'
        value += c
        continue
      }
    }
    break
  }
  const num = Number.parseFloat(value)
  if (Number.isNaN(num))
    return [cursor, null]
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

    // eslint-disable-next-line prefer-const -- both reassigned via destructuring below
    let newCursor = i
    let number: number | null = null
    if (command === 'A' || command === 'a') {
      const position = args.length
      if (position === 0 || position === 1 || position === 2 || position === 5 || position === 6)
        [newCursor, number] = readNumber(string, i)
      if (position === 3 || position === 4) {
        if (c === '0')
          number = 0
        if (c === '1')
          number = 1
      }
    }
    else {
      [newCursor, number] = readNumber(string, i)
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

function roundAndStringify(num: number, precision?: number): { roundedStr: string, rounded: number } {
  if (precision != null)
    num = toFixed(num, precision)
  return { roundedStr: removeLeadingZero(num), rounded: num }
}

function stringifyArgs(
  command: string,
  args: ReadonlyArray<number>,
  precision: number | undefined,
  disableSpaceAfterFlags: boolean | undefined,
): string {
  let result = ''
  let previous: number | undefined
  for (let i = 0; i < args.length; i++) {
    const { roundedStr, rounded } = roundAndStringify(args[i]!, precision)
    if (
      disableSpaceAfterFlags
      && (command === 'A' || command === 'a')
      && (i % 7 === 4 || i % 7 === 5)
    ) {
      result += roundedStr
    }
    else if (i === 0 || rounded < 0) {
      result += roundedStr
    }
    else if (previous !== undefined && !Number.isInteger(previous) && !isDigit(roundedStr[0]!)) {
      result += roundedStr
    }
    else {
      result += ` ${roundedStr}`
    }
    previous = rounded
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
