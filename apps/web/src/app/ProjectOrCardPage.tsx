import { useParams } from 'react-router'
import { CardAddressPage } from '../boards/CardAddressPage'
import { isCardNumber } from '../boards/card-number'
import { ProjectPage } from '../projects/ProjectPage'

// /WEB is a project, /WEB-12 a card.
export function ProjectOrCardPage() {
  const { code = '' } = useParams()
  return isCardNumber(code) ? <CardAddressPage /> : <ProjectPage />
}
