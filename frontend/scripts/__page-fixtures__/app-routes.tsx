import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

function AppShell() { return <div /> }
function Home() { return <div>home</div> }
function Settings() { return <div>settings</div> }
function Programs() { return <div>programs</div> }

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="settings/integrations" element={<Settings />} />
          <Route path="programs" element={<Programs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
