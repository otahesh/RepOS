import { useNavigate } from 'react-router-dom'
import { ProgramCatalog } from '../components/programs/ProgramCatalog'
import { TOKENS } from '../tokens'

// Browse template catalog. ProgramCatalog owns its own fetch; we just
// route the picked slug to the detail page.
export default function ProgramsPage() {
  const navigate = useNavigate()
  return (
    <div style={{ color: TOKENS.text }}>
      <ProgramCatalog onPick={(slug) => navigate(`/programs/${slug}`)} />
    </div>
  )
}
