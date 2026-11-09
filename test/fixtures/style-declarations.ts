export const declarationCases: { style: string, keepImportant: boolean, expected: Record<string, string> }[] = [
  {
    style: 'fill:red;',
    keepImportant: false,
    expected: {
      fill: 'red'
    }
  },
  {
    style: 'fill: red; stroke:blue',
    keepImportant: false,
    expected: {
      fill: 'red',
      stroke: 'blue'
    }
  },
  {
    style: 'font-family:"A; B";stroke:red',
    keepImportant: false,
    expected: {
      'font-family': 'A; B',
      stroke: 'red'
    }
  },
  {
    style: 'fill:url("data:image/svg+xml;a:b");opacity:.5',
    keepImportant: false,
    expected: {
      fill: 'url("data:image/svg+xml;a:b")',
      opacity: '.5'
    }
  },
  {
    style: 'fill:rgb(1,2,3);stroke:blue',
    keepImportant: false,
    expected: {
      fill: 'rgb(1,2,3)',
      stroke: 'blue'
    }
  },
  {
    style: 'fill:var(--paint, rgb(1,2,3));stroke:red',
    keepImportant: false,
    expected: {
      fill: 'var(--paint, rgb(1,2,3))',
      stroke: 'red'
    }
  },
  {
    style: '/*a*/fill/*b*/:red;stroke:blue/*c*/',
    keepImportant: false,
    expected: {
      fill: 'red',
      stroke: 'blue'
    }
  },
  {
    style: 'fill:red!important;stroke:blue',
    keepImportant: false,
    expected: {
      fill: 'red',
      stroke: 'blue'
    }
  },
  {
    style: 'fill:red!important;stroke:blue',
    keepImportant: true,
    expected: {
      stroke: 'blue'
    }
  },
  {
    style: 'fill:red!important',
    keepImportant: true,
    expected: {
      style: 'fill:red!important'
    }
  },
  {
    style: 'FILL:BLUE;--x: 2; custom: value',
    keepImportant: false,
    expected: {
      style: '--x:2;custom:value',
      fill: 'BLUE'
    }
  },
  {
    style: 'stroke:"red";fill:"blue"',
    keepImportant: false,
    expected: {
      stroke: 'red',
      fill: 'blue'
    }
  },
  {
    style: 'f\\ill:red;fill:bl\\ue',
    keepImportant: false,
    expected: {
      fill: 'blue'
    }
  },
  {
    style: 'fill:\\72 ed;stroke:blue',
    keepImportant: false,
    expected: {
      fill: '\\72 ed',
      stroke: 'blue'
    }
  },
  {
    style: 'opacity:.5;opacity:.8;unknown:"a;b"',
    keepImportant: false,
    expected: {
      style: 'unknown:"a;b"',
      opacity: '.8'
    }
  },
  {
    style: 'fill:url(data:a;b);unknown:calc(1 + (2))',
    keepImportant: false,
    expected: {
      style: 'unknown:calc(1 + (2))',
      fill: 'url(data:a;b)'
    }
  },
  {
    style: 'nonsense;fill:red',
    keepImportant: false,
    expected: {
      style: 'nonsense;fill:red'
    }
  },
  {
    style: 'fill:"unclosed;stroke:red',
    keepImportant: false,
    expected: {
      fill: 'unclosed;stroke:re'
    }
  },
  {
    style: 'fill:red;broken:(;stroke:blue',
    keepImportant: false,
    expected: {
      style: 'broken:(',
      fill: 'red',
      stroke: 'blue'
    }
  },
  {
    style: 'fill:red;/**/stroke:blue',
    keepImportant: false,
    expected: {
      fill: 'red',
      stroke: 'blue'
    }
  },
  {
    style: '',
    keepImportant: false,
    expected: {
      style: ''
    }
  }
]
