// What a sign-up has to carry now that the age rule and the Terms acceptance are
// enforced in `validateRegistration` rather than only in the form.
//
// Most of the auth suite is about credentials — salting, sanitising, duplicates,
// the role a sign-up does and does not get — so those cases want a registration
// that already satisfies the two checks they are not about. Spreading this in
// keeps each case reading as one line about its own subject.
import type { RegistrationInput } from '../../src/lib/auth'

/** A date of birth comfortably over the minimum age. */
export const AN_ADULT = '1990-04-17'

export function guestRegistration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    email: 'maria@example.com',
    password: 'bahay-kubo-9',
    birthdate: AN_ADULT,
    acceptedTerms: true,
    ...overrides,
  }
}