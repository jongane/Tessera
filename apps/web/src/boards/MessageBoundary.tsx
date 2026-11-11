import { Component, type ReactNode } from 'react'
import { PlainBody } from './message-markdown'

// If one message cannot be drawn, it shows as the text that was written, and
// the rest of the chat and the board carry on. Give it the text as its `key`,
// so an edited message gets another try.
export class MessageBoundary extends Component<
  { markdown: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? (
      <PlainBody markdown={this.props.markdown} />
    ) : (
      this.props.children
    )
  }
}
