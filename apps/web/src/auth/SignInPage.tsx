import { signInSchema } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useMe, useServerSettings, useSignIn } from '../api/auth'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { Loading } from '../ui/Loading'
import { TextField } from '../ui/TextField'
import { AuthLayout } from './AuthLayout'
import { PasswordField } from './PasswordField'
import { safeReturnTo } from './return-to'

export function SignInPage() {
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const me = useMe()
  const settings = useServerSettings()
  const signIn = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (me.isPending) {
    return <Loading />
  }
  if (me.data && !signIn.isSuccess) {
    return <Navigate to={returnTo} replace />
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(signInSchema, { email, password })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    signIn.mutate(checked.data, {
      onSuccess: () => navigate(returnTo, { replace: true }),
    })
  }

  return (
    <AuthLayout
      title="Sign in to Tessera"
      footer={
        settings.data?.signUpOpen && (
          <>
            New here?{' '}
            <Link
              to="/sign-up"
              className="font-semibold text-accent hover:text-accent-strong"
            >
              Create an account
            </Link>
          </>
        )
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {signIn.error && <Alert>{signIn.error.message}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <PasswordField
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        <Button type="submit" disabled={signIn.isPending}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
