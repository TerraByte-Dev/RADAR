// Focus management (renderer spec 11): when a view or a first-run step replaces what held focus,
// focus would fall to the page and a screen reader would lose its place. It goes to the new
// heading instead, which is not a control, so it draws no ring. Focus held elsewhere (a list, a
// field, an overlay) is left where it is.
export function focusHeading(): void {
  const el = document.activeElement
  if (el && el !== document.body) return
  const h = document.querySelector<HTMLElement>('main h1')
  if (!h) return
  h.tabIndex = -1
  h.focus({ preventScroll: true })
}
