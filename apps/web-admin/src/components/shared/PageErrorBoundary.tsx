import React, { type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PageErrorBoundaryProps {
  children: ReactNode
  pageName?: string
}

interface PageErrorBoundaryState {
  hasError: boolean
  errorMessage: string
}

class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  constructor(props: PageErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }

  static getDerivedStateFromError(error: unknown): PageErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred."
    return { hasError: true, errorMessage: message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[PageErrorBoundary] Caught error:", error, info)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: "" })
  }

  render(): ReactNode {
    const { hasError, errorMessage } = this.state
    const { children, pageName } = this.props

    if (hasError) {
      const title = pageName
        ? `The ${pageName} page encountered an error`
        : "This page encountered an error"

      return (
        <div className="flex items-center justify-center p-8">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-destructive">{title}</CardTitle>
            </CardHeader>
            {errorMessage ? (
              <CardContent>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </CardContent>
            ) : null}
            <CardFooter>
              <Button variant="outline" onClick={this.handleReset}>
                Try Again
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return children
  }
}

export default PageErrorBoundary
export { PageErrorBoundary }
