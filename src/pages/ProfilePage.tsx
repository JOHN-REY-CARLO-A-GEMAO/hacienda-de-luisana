import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { LOCAL_PROFILES_KEY } from '../lib/authLocal'
import { useAuth } from '../hooks/useAuth'
import { composeFullName, validateBirthdate, validateNamePart, validatePhMobile } from '../lib/validation'
import { LogOut } from '../lib/icons'
import { Alert, Container, Field, Input, Page, PageHeader } from '../components/ui'
import { Flyleaf } from '../components/Account'

/** Guest profile has its own protected route, separate from booking history. */
export function ProfilePage() {
  const { user, profile, logout, refresh } = useAuth()
  // Profile Form state
  const [firstName, setFirstName] = useState(profile?.first_name ?? '')
  const [middleName, setMiddleName] = useState(profile?.middle_name ?? '')
  const [lastName, setLastName] = useState(profile?.last_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [birthdate, setBirthdate] = useState(profile?.birthdate ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '')
      setMiddleName(profile.middle_name ?? '')
      setLastName(profile.last_name ?? '')
      setPhone(profile.phone ?? '')
      setBirthdate(profile.birthdate ?? '')
    }
  }, [profile])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileMsg(null)

    if (!user?.uid) return

    const fn = validateNamePart(firstName, 'First name')
    if (!fn.ok) {
      setProfileMsg({ tone: 'bad', text: fn.message })
      return
    }
    const ln = validateNamePart(lastName, 'Last name')
    if (!ln.ok) {
      setProfileMsg({ tone: 'bad', text: ln.message })
      return
    }
    const mn = validateNamePart(middleName, 'Middle name', { required: false, min: 1 })
    if (!mn.ok) {
      setProfileMsg({ tone: 'bad', text: mn.message })
      return
    }
    const ph = validatePhMobile(phone)
    if (!ph.ok) {
      setProfileMsg({ tone: 'bad', text: ph.message })
      return
    }
    if (birthdate.trim()) {
      const bd = validateBirthdate(birthdate)
      if (!bd.ok) {
        setProfileMsg({ tone: 'bad', text: bd.message })
        return
      }
    }

    setProfileSaving(true)
    try {
      const displayName = composeFullName({ first: firstName, middle: middleName, last: lastName })
      const payload = {
        uid: user.uid,
        role: profile?.role ?? 'guest',
        display_name: displayName,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim(),
        phone: phone.trim(),
        birthdate: birthdate.trim() || null,
        updated_at: new Date().toISOString(),
      }

      if (db) {
        const profileRef = doc(db, 'profiles', user.uid)
        await setDoc(profileRef, payload, { merge: true })
      } else {
        const local: Array<Record<string, unknown>> = JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY) || '[]')
        if (!Array.isArray(local)) throw new Error('Could not read the local profile store.')
        const previous = local.find((entry) => entry.uid === user.uid)
        localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify([
          ...local.filter((entry) => entry.uid !== user.uid),
          { ...previous, ...payload },
        ]))
      }

      await refresh()
      setProfileMsg({ tone: 'good', text: 'Your profile details have been saved successfully!' })
    } catch (err: any) {
      setProfileMsg({ tone: 'bad', text: err?.message || 'Failed to update profile.' })
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <Page className="ledger-ground">
      <Container width="wide">
        <PageHeader eyebrow="Your account" title="My profile" lead="Keep your details up to date so the Hacienda can reach you about your stay." actions={<Link to="/mybookings" className="btn-ghost">My bookings</Link>} />
        <div className="ledger-grid mt-8">
          <section className="ledger-sheet" aria-label="My profile">
              <div className="ledger-page">
                <h2 className="sr-only">Profile details</h2>
                <p className="ledger-lede">
                  Keep these current so the Admin can reach you about a stay. Your name is the one the
                  invoice and the Hacienda's own record use.
                </p>

                {profileMsg && (
                  <Alert tone={profileMsg.tone === 'good' ? 'success' : 'danger'} className="mt-5">
                    {profileMsg.text}
                  </Alert>
                )}

                <form onSubmit={handleSaveProfile} className="mt-7 space-y-8">
                  <fieldset className="ledger-group">
                    <legend className="ledger-group-title">Your name</legend>
                    <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="First name" required>
                        <Input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                          placeholder="First name"
                          autoComplete="given-name"
                        />
                      </Field>
                      <Field label="Last name" required>
                        <Input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          required
                          placeholder="Last name"
                          autoComplete="family-name"
                        />
                      </Field>
                    </div>
                    <div className="mt-5">
                      <Field label="Middle name" hint="Optional — an initial is enough.">
                        <Input
                          value={middleName}
                          onChange={(e) => setMiddleName(e.target.value)}
                          placeholder="Middle name"
                          autoComplete="additional-name"
                        />
                      </Field>
                    </div>
                  </fieldset>

                  <fieldset className="ledger-group">
                    <legend className="ledger-group-title">How the Hacienda reaches you</legend>
                    <div className="mt-4 space-y-5">
                      <Field
                        label="Mobile phone number"
                        required
                        hint="Philippine mobile format: 09XX XXX XXXX"
                      >
                        <Input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                          placeholder="09171234567"
                          inputMode="tel"
                          autoComplete="tel"
                        />
                      </Field>

                      <Field label="Email address" hint="The sign-in address cannot be changed here.">
                        <Input value={user?.email ?? ''} disabled />
                      </Field>
                    </div>
                  </fieldset>

                  <fieldset className="ledger-group">
                    <legend className="ledger-group-title">About you</legend>
                    <div className="mt-4">
                      <Field label="Date of birth" hint="Optional.">
                        <Input
                          type="date"
                          value={birthdate}
                          onChange={(e) => setBirthdate(e.target.value)}
                          autoComplete="bday"
                        />
                      </Field>
                    </div>
                  </fieldset>

                  <div className="ledger-formfoot">
                    <button type="submit" disabled={profileSaving} className="btn-primary">
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => void logout()} className="btn-ghost">
                      <LogOut size={16} aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </form>
              </div>
          </section>
          <Flyleaf name={profile?.display_name || user?.displayName || user?.email || 'Guest'} email={user?.email} memberSince={profile?.created_at} />
        </div>
      </Container>
    </Page>
  )
}
