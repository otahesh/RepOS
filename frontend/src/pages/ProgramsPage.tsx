import { useNavigate } from 'react-router-dom'
import { ProgramCatalog } from '../components/programs/ProgramCatalog'
import { MyLibrary } from '../components/programs/MyLibrary'
import { TOKENS, FONTS } from '../tokens'

// Programs page: My Programs library (top) + template catalog (bottom).
// Restart from Past tab sends user back to the fork-wizard detail page so
// they can rename / customize before restarting.
export default function ProgramsPage() {
  const navigate = useNavigate()
  return (
    <div style={{ color: TOKENS.text, display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div style={{ padding: '24px 24px 0' }}>
        <MyLibrary onRestartProgram={(id) => navigate(`/programs`, { state: { restartId: id } })} />
      </div>

      <section>
        <div style={{ padding: '0 24px 8px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: TOKENS.text, letterSpacing: -0.3, fontFamily: FONTS.ui }}>
            Browse Templates
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
            Pick a template to customize and fork into your library.
          </p>
        </div>
        <ProgramCatalog onPick={(slug) => navigate(`/programs/${slug}`)} />
      </section>
    </div>
  )
}
