import { Loading } from 'solid-js'
import { Router } from './router'

// The app root: the router and the site-wide layout live here. Pages are
// the modules under src/routes.
export default function App() {
  return (
    <Router>
      {props => (
        <>
          <Loading fallback={<main>Loading…</main>}>{props.children}</Loading>
        </>
      )}
    </Router>
  )
}
