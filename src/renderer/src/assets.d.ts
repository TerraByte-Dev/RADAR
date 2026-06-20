// Asset module declarations so the renderer can `import logo from './assets/logo.png'`.
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
