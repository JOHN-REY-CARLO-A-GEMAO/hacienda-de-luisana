import { useEffect, useState, useMemo } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { calculateNights, formatStayDuration, getStayProgress, type Booking } from '../../lib/storage'
import { ACCOMMODATIONS } from '../../config/site'
import { Screen, ScreenTitle } from '../components/Screen'
import { Clock, Users, Bed, Sparkle } from '../../lib/icons'

export function ClientAnalyticsScreen() {
  const [items, setItems] = useState<Booking[]>([])

  useEffect(() => {
    const unsub = cloudBookingsDB.subscribe(setItems)
    return () => unsub()
  }, [])

  // Analytics Computations
  const stats = useMemo(() => {
    const totalBookings = items.length
    const reserved = items.filter((b) => b.status === 'Reserved' || b.status === 'Completed')
    const pending = items.filter((b) => b.status === 'Pending')
    const cancelled = items.filter((b) => b.status === 'Cancelled')

    // Guest Count
    const totalGuests = items
      .filter((b) => b.status !== 'Cancelled')
      .reduce((sum, b) => sum + (b.guests || 1), 0)

    // Length of stay calculations
    let totalNights = 0
    let validStayCount = 0
    const stayBuckets = {
      oneNight: 0,
      twoNights: 0,
      threeToFourNights: 0,
      fivePlusNights: 0,
    }

    // Revenue estimation
    let totalEstimatedRevenue = 0
    let reservedRevenue = 0

    items.forEach((b) => {
      const nights = calculateNights(b.check_in, b.check_out)
      const acc = ACCOMMODATIONS.find((a) => a.id === b.accommodation)
      const pricePerNight = acc?.price || 12000
      const bookingVal = pricePerNight * nights

      if (b.status !== 'Cancelled') {
        totalNights += nights
        validStayCount += 1
        totalEstimatedRevenue += bookingVal

        if (nights === 1) stayBuckets.oneNight += 1
        else if (nights === 2) stayBuckets.twoNights += 1
        else if (nights >= 3 && nights <= 4) stayBuckets.threeToFourNights += 1
        else stayBuckets.fivePlusNights += 1
      }

      if (b.status === 'Reserved' || b.status === 'Completed') {
        reservedRevenue += bookingVal
      }
    })

    const avgStayNights = validStayCount > 0 ? (totalNights / validStayCount).toFixed(1) : '0'

    // Popular accommodations
    const accCounts: Record<string, number> = {}
    items
      .filter((b) => b.status !== 'Cancelled')
      .forEach((b) => {
        accCounts[b.accommodation] = (accCounts[b.accommodation] || 0) + 1
      })

    const popularAccs = Object.entries(accCounts)
      .map(([id, count]) => {
        const found = ACCOMMODATIONS.find((a) => a.id === id)
        return {
          id,
          name: found?.name || (id === 'other' ? 'Custom Accommodation' : id),
          count,
          percentage: totalBookings > 0 ? Math.round((count / totalBookings) * 100) : 0,
        }
      })
      .sort((a, b) => b.count - a.count)

    // Currently active stays
    const currentActiveStays = items
      .filter((b) => b.status === 'Reserved')
      .map((b) => ({
        ...b,
        stayInfo: getStayProgress(b.check_in, b.check_out),
      }))
      .filter((b) => b.stayInfo.isCurrentStay)

    return {
      totalBookings,
      reservedCount: reserved.length,
      pendingCount: pending.length,
      cancelledCount: cancelled.length,
      confirmationRate: totalBookings > 0 ? Math.round((reserved.length / totalBookings) * 100) : 0,
      totalGuests,
      totalNights,
      avgStayNights,
      stayBuckets,
      totalEstimatedRevenue,
      reservedRevenue,
      popularAccs,
      currentActiveStays,
    }
  }, [items])

  return (
    <Screen>
      <ScreenTitle eyebrow="App for Client · Analytics" title="Performance & Stay Analytics">
        <p className="mt-1 text-sm text-forest-800/70">
          Analytics para sa Client: kita, conversion, at buong detalye kung gaano katagal ang stay ng mga booker.
        </p>
      </ScreenTitle>

      {/* Primary KPI Highlights */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-forest-900 text-cream-50 rounded-3xl p-4 shadow-card">
          <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Estimated Revenue</div>
          <div className="font-serif text-2xl sm:text-3xl mt-1 text-white">
            ₱{stats.reservedRevenue.toLocaleString()}
          </div>
          <div className="text-[10px] text-cream-100/70 mt-1">
            Reserved: ₱{stats.reservedRevenue.toLocaleString()}
          </div>
        </div>

        <div className="bg-emerald-800 text-cream-50 rounded-3xl p-4 shadow-card">
          <div className="text-[10px] uppercase tracking-eyebrow text-emerald-200">Average Stay Duration</div>
          <div className="font-serif text-2xl sm:text-3xl mt-1 text-white">
            {stats.avgStayNights} <span className="text-base font-sans font-normal text-emerald-200">gabi</span>
          </div>
          <div className="text-[10px] text-emerald-200 mt-1">
            {stats.totalNights} kabuuang gabi na-book
          </div>
        </div>

        <div className="bg-white rounded-3xl p-4 border border-forest-900/5 shadow-card">
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Confirmation Rate</div>
          <div className="font-serif text-2xl sm:text-3xl mt-1 text-forest-900">
            {stats.confirmationRate}%
          </div>
          <div className="text-[10px] text-forest-700/60 mt-1">
            {stats.reservedCount} out of {stats.totalBookings} inquiries
          </div>
        </div>

        <div className="bg-white rounded-3xl p-4 border border-forest-900/5 shadow-card">
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Total Guests Accommodated</div>
          <div className="font-serif text-2xl sm:text-3xl mt-1 text-forest-900">
            {stats.totalGuests}
          </div>
          <div className="text-[10px] text-forest-700/60 mt-1">
            Across active reservations
          </div>
        </div>
      </div>

      {/* Currently Checked-in / Active Guests Staying Right Now */}
      {stats.currentActiveStays.length > 0 && (
        <div className="mb-6 bg-gradient-to-r from-emerald-50 to-cream-100 border border-emerald-300 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-eyebrow text-emerald-900 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
              Kasalukuyang Nanunuluyan (Active Stay Right Now)
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-bold">
              {stats.currentActiveStays.length} Booker
            </span>
          </div>

          <div className="space-y-3 mt-3">
            {stats.currentActiveStays.map((b) => (
              <div key={b.id} className="bg-white rounded-2xl p-3.5 border border-emerald-200/60 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-forest-900 text-sm">{b.guest_name}</span>
                  <span className="font-mono text-[11px] text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">
                    Day {b.stayInfo.dayNumber} of {b.stayInfo.totalDays}
                  </span>
                </div>
                <div className="text-forest-700/70 mt-1">
                  Tagal: <strong>{formatStayDuration(b.check_in, b.check_out)}</strong> · Check-out: {b.check_out} (12:00 PM)
                </div>
                <div className="mt-2 w-full bg-forest-900/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-600 h-2 rounded-full transition-all"
                    style={{ width: `${b.stayInfo.progressPercent}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-forest-600">
                  <span>{b.stayInfo.progressPercent}% ng stay tapos na</span>
                  <span>{b.stayInfo.hoursRemaining} oras natitira bago mag-checkout</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Section: Gaano Katagal ang Stay ni Booker (Stay Duration Distribution) */}
      <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-5 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
              Length of Stay Analysis
            </div>
            <h3 className="font-serif text-xl text-forest-900 mt-0.5">Gaano Katagal ang Stay ng mga Booker?</h3>
          </div>
          <span className="w-8 h-8 rounded-full bg-forest-50 text-forest-800 flex items-center justify-center text-xs">
            <Clock size={16} />
          </span>
        </div>

        <p className="text-xs text-forest-800/75 leading-relaxed mb-4">
          Pamamahagi ng haba ng pananatili ng mga bisita sa Hacienda de LuisAna (mula 1-night getaways hanggang extended vacations):
        </p>

        {/* Stay Distribution Visual Bars */}
        <div className="space-y-3.5">
          {[
            {
              label: '1 Night (Overnight / Quick Stay)',
              count: stats.stayBuckets.oneNight,
              sub: 'Karaniwan tuwing weekdays o mabilisang pahinga',
            },
            {
              label: '2 Nights (Weekend Getaway / Standard)',
              count: stats.stayBuckets.twoNights,
              sub: 'Pinakapaboritong tagal ng mga pamilya at barkada',
            },
            {
              label: '3 - 4 Nights (Extended Vacation)',
              count: stats.stayBuckets.threeToFourNights,
              sub: 'Long weekend at bakasyon ng mga balikbayan',
            },
            {
              label: '5+ Nights (Workcation / Long Stay)',
              count: stats.stayBuckets.fivePlusNights,
              sub: 'Pahinga at retreat sa malamig na hangin ng Luisiana',
            },
          ].map((item, idx) => {
            const total = Math.max(1, stats.totalBookings - stats.cancelledCount)
            const percent = Math.round((item.count / total) * 100)

            return (
              <div key={idx} className="bg-cream-50/70 rounded-2xl p-3 border border-forest-900/5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-forest-900">{item.label}</span>
                  <span className="font-bold text-forest-800">
                    {item.count} stay{item.count !== 1 ? 's' : ''} ({percent}%)
                  </span>
                </div>
                <div className="w-full bg-forest-900/10 h-2 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      idx === 0
                        ? 'bg-amber-600'
                        : idx === 1
                        ? 'bg-emerald-700'
                        : idx === 2
                        ? 'bg-forest-800'
                        : 'bg-indigo-600'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="text-[10px] text-forest-700/60 mt-1">{item.sub}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Popular Accommodations Breakdown */}
      <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-5 sm:p-6 mb-6">
        <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
          Accommodations Demand
        </div>
        <h3 className="font-serif text-xl text-forest-900 mt-0.5">Karamihan sa Pina-reserve</h3>

        <div className="mt-4 space-y-3">
          {stats.popularAccs.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between text-xs p-3 rounded-2xl bg-cream-50/60 border border-forest-900/5">
              <div className="flex items-center gap-2">
                <Bed size={15} className="text-forest-600" />
                <span className="font-medium text-forest-900">{acc.name}</span>
              </div>
              <div className="text-right">
                <span className="font-bold text-forest-900">{acc.count} bookings</span>
                <span className="text-[10px] text-forest-700/60 block">{acc.percentage}% demand</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Booking Status Breakdown */}
      <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-5 sm:p-6">
        <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
          Pipeline Summary
        </div>
        <h3 className="font-serif text-xl text-forest-900 mt-0.5">Booking Status Breakdown</h3>

        <div className="grid grid-cols-3 gap-2.5 mt-4 text-center">
          <div className="bg-amber-50 rounded-2xl p-3 border border-amber-200/60">
            <div className="text-[10px] uppercase tracking-eyebrow text-amber-800">Pending</div>
            <div className="font-serif text-2xl text-amber-900 mt-0.5">{stats.pendingCount}</div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-3 border border-emerald-200/60">
            <div className="text-[10px] uppercase tracking-eyebrow text-emerald-800">Reserved</div>
            <div className="font-serif text-2xl text-emerald-900 mt-0.5">{stats.reservedCount}</div>
          </div>
          <div className="bg-red-50 rounded-2xl p-3 border border-red-200/60">
            <div className="text-[10px] uppercase tracking-eyebrow text-red-800">Cancelled</div>
            <div className="font-serif text-2xl text-red-900 mt-0.5">{stats.cancelledCount}</div>
          </div>
        </div>
      </div>
    </Screen>
  )
}
