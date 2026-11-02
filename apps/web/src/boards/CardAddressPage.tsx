import { Navigate, useParams } from 'react-router'
import { isApiError } from '../api/client'
import { useCardByNumber } from '../api/boards'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Loading } from '../ui/Loading'

// /WEB-12 opens the card's board with the card highlighted and its panel open
// (docs/web-app.md, section 2).
export function CardAddressPage() {
  const { code: reference = '' } = useParams()
  const card = useCardByNumber(reference)

  if (card.isPending) {
    return <Loading />
  }
  // The project code is the part of the number before the first "-".
  const dash = card.data?.number.indexOf('-') ?? -1
  if (isApiError(card.error, 404) || (card.data && dash < 1)) {
    return (
      <NotFoundPage
        title="Card not found"
        text="There’s no card with that number, or you’re not a member of its project."
      />
    )
  }
  if (!card.data) {
    return (
      <div className="p-6">
        <Alert>{card.error?.message}</Alert>
      </div>
    )
  }
  const { number, boardId, id } = card.data
  const code = number.slice(0, dash)
  return <Navigate to={`/${code}/boards/${boardId}?card=${id}`} replace />
}
