import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SmartImage } from '../../src/components/SmartImage'

describe('SmartImage component', () => {
  it('passes fetchpriority and loading attributes to the rendered img element', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <SmartImage
          src="/images/gmaps/img-07.jpg"
          alt="Hero image"
          loading="eager"
          fetchpriority="high"
        />
      )
    })

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('loading')).toBe('eager')
    expect(img?.getAttribute('fetchpriority')).toBe('high')

    act(() => {
      root.unmount()
    })
    document.body.removeChild(container)
  })
})
