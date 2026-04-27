import type { BunPressConfig } from '@stacksjs/bunpress'

const config: Partial<BunPressConfig> = {
  title: 'ts-svg',
  description: 'Pure-TypeScript SVG parser, rasterizer, and PNG encoder for Bun & Node.',

  nav: [
    { text: 'Guide', link: '/intro' },
    { text: 'API', link: '/api' },
    { text: 'Features', link: '/features/parser' },
    { text: 'Advanced', link: '/advanced/resvg-shim' },
    { text: 'Config', link: '/config' },
  ],

  themeConfig: {
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/intro' },
            { text: 'Install', link: '/install' },
            { text: 'Usage', link: '/usage' },
            { text: 'Configuration', link: '/config' },
            { text: 'API Reference', link: '/api' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Element tree', link: '/features/parser' },
            { text: 'Rendering', link: '/features/rendering' },
            { text: 'Paths', link: '/features/paths' },
            { text: 'Paint servers', link: '/features/paint-servers' },
            { text: 'Strokes', link: '/features/strokes' },
            { text: 'Clip & mask', link: '/features/clip-mask' },
            { text: 'Transforms', link: '/features/transforms' },
            { text: 'Text', link: '/features/text' },
            { text: 'use references', link: '/features/use' },
          ],
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Resvg shim', link: '/advanced/resvg-shim' },
            { text: 'Buffer reuse', link: '/advanced/buffer-reuse' },
            { text: 'Font resolvers', link: '/advanced/font-resolvers' },
            { text: 'Image resolvers', link: '/advanced/image-resolvers' },
            { text: 'Custom pipeline', link: '/advanced/custom-pipeline' },
            { text: 'CLI', link: '/advanced/cli' },
            { text: 'Performance', link: '/advanced/performance' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'Showcase', link: '/showcase' },
            { text: 'Team', link: '/team' },
            { text: 'Sponsors', link: '/sponsors' },
            { text: 'Partners', link: '/partners' },
            { text: 'Postcardware', link: '/postcardware' },
            { text: 'Stargazers', link: '/stargazers' },
            { text: 'License', link: '/license' },
          ],
        },
      ],
    },
  },
}

export default config
