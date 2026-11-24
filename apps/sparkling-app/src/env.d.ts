// Static assets imported from TSX are resolved by Rsbuild into bundle URLs.
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
