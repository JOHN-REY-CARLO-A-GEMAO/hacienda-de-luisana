# Firebase Authentication templates — Hacienda de LuisAna

**Draft only:** these settings have not been applied to the Firebase project. The
Firebase Console stores Authentication templates separately from this repository;
changing this file does not update them. The templates apply project-wide to
both the Guest website and the Admin app.

## Before editing

1. In the `hacienda-de-luisana` Firebase project, open **Authentication →
   Templates**. Select each email template and click its pencil icon.
2. For each email template, where the field is editable, use:
   - **Sender name:** `Hacienda de LuisAna`
   - **Reply to:** `haciendadeluisiana@gmail.com` (the contact address published
     on the website; use it only if this inbox is monitored)
   - **From:** leave the current Firebase sender unchanged. A different sender
     domain requires additional setup and domain verification.
3. Use the subjects below. Paste a message only if its **Message** field is
   editable, and save each template individually.

Keep Firebase's placeholders exactly as written, especially `%LINK%`: Firebase
replaces it with the recipient's unique action link. Leave the existing action
URL and SMTP settings unchanged; pointing the action URL at a normal website
page without an action handler can break the links. If you use `%APP_NAME%`,
check that the project's **Public-facing name** is `Hacienda de LuisAna`.

Firebase's standard sender offers limited customization. Its help documentation
says the **password reset** body can be edited, while other email bodies may be
fixed. If a field is read-only or Firebase refuses an edit, leave the existing
value in place rather than removing its security instructions or action link.
The SMS verification message may also be read-only. See [Firebase's template
help](https://support.google.com/firebase/answer/7000714?hl=en).

## Email address verification

**Subject**

```text
Verify your email for Hacienda de LuisAna
```

**Optional message** — use only if Firebase lets you edit this body; otherwise
keep its existing verification message and action link.

```text
Hello,

Thank you for joining Hacienda de LuisAna. Please verify your email address by
following this link:

%LINK%

If you did not request this verification, you can ignore this email.

Thank you,
Hacienda de LuisAna
```

## Password reset

**Subject**

```text
Reset your Hacienda de LuisAna password
```

**Message**

```text
Hello,

We received a request to reset the password for your Hacienda de LuisAna account.
To choose a new password, follow this link:

%LINK%

If you did not request a password reset, you can ignore this email. Your
password will not change unless the reset is completed.

Need help? Contact us at haciendadeluisiana@gmail.com.

Thank you,
Hacienda de LuisAna
```

## Email address change

**Subject**

```text
Your Hacienda de LuisAna sign-in email was changed
```

**Optional message** — use only if Firebase lets you edit this body; otherwise
keep its existing message and recovery link. This notification goes to the old
address and provides a way to undo an unauthorized change; it is not a link to
approve the change.

```text
Hello,

The sign-in email for your Hacienda de LuisAna account was changed to
%NEW_EMAIL%.

If you did not make this change, follow the link below to restore your previous
email address. Afterward, reset your password and contact us at
haciendadeluisiana@gmail.com.

%LINK%

Thank you,
Hacienda de LuisAna
```

## Multi-factor enrollment notification

**Subject** (if Firebase allows it to be edited)

```text
A sign-in verification method was added to your Hacienda de LuisAna account
```

**Optional message** — use only if Firebase lets you edit this body; otherwise
keep its existing message and link for removing an unauthorized second factor.

```text
Hello,

A new two-step verification method was added to your Hacienda de LuisAna account.

If you did not add it, follow the link below to remove the new method.
Afterward, reset your password and contact us at haciendadeluisiana@gmail.com.

%LINK%

Thank you,
Hacienda de LuisAna
```

Editing this template does not enable multi-factor authentication.

## SMS verification

Leave the Firebase-provided SMS text and its code placeholder intact if the
console does not allow editing. Editing a template does not enable phone sign-in
or multi-factor authentication.

## Check after saving

1. Use a test Guest account you own on the deployed website. From the sign-in
   screen, request a password reset and check the inbox and spam folder.
2. Confirm the sender name, subject and message, then open the link and complete
   a reset for that test account. Never share the action link with anyone.
3. After the updated website is deployed, register a new test Guest using an
   inbox you control. The website requests a Firebase verification email; check
   the inbox and spam folder, then open the link. Back on the website, choose
   **I have verified my email** to refresh the verification status and ID token.
4. If the request fails, the account still exists. Use **Send verification
   email** from My Bookings or My Profile to retry; do not register it again.
   Google and browser-only demo accounts do not use this email flow. Verification
   is informational and does not block Guest access.

The repository changes and these draft templates are not a deployment. A local
Auth-emulator test does not prove real email delivery or console settings.
