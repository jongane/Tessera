import { signUpSchema } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMe, useServerSettings, useSignUp } from '../api/auth'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { Loading } from '../ui/Loading'
import { TextField } from '../ui/TextField'
import { AuthLayout } from './AuthLayout'
import { PasswordField } from './PasswordField'

export function SignUpPage() {
  const me = useMe()
  const settings = useServerSettings()
  const signUp = useSignUp()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (me.isPending || settings.isPending) {
    return <Loading />
  }
  if (me.data && !signUp.isSuccess) {
    return <Navigate to="/projects" replace />
  }

  const signInLink = (
    <>
      Already have an account?{' '}
      <Link
        to="/sign-in"
        className="font-semibold text-accent hover:text-accent-strong"
      >
        Sign in
      </Link>
    </>
  )

  if (settings.data && !settings.data.signUpOpen) {
    return (
      <AuthLayout title="Create an account" footer={signInLink}>
        <p>Sign-up is closed. Ask your server admin for an account.</p>
      </AuthLayout>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(signUpSchema, { displayName, email, password })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    signUp.mutate(checked.data, {
      onSuccess: () => navigate('/projects', { replace: true }),
    })
  }

  return (
    <AuthLayout title="Create an account" footer={signInLink}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {signUp.error && <Alert>{signUp.error.message}</Alert>}
        <TextField
          label="Your name"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={errors.displayName}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <PasswordField
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          hint="At least 10 characters"
        />
        <Button type="submit" disabled={signUp.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
