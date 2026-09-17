import { Screen, ScreenTitle } from '../components/Screen'

// No ESP32 hardware yet -> SIM MODE. Records table appears here once
// hardware/Flutter syncLogs wires to Firestore `access_logs`.
export function AdminRecordsScreen() {
  return (
    <Screen>
      <ScreenTitle eyebrow="Owner · Records" title="Smart lock">
        <p className="mt-1 text-sm text-forest-800/70">
          No ESP32 connected — SIM mode. Counts will appear here after hardware setup.
        </p>
      </ScreenTitle>
      <div className="rounded-[22px] bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        <div className="font-semibold text-xs uppercase tracking-eyebrow">SIM mode · no hardware</div>
        <p className="mt-2 leading-relaxed">
          Unlocks are simulated (800ms handshake, 5s auto-relock in the Flutter prototype).
          Nothing is written to <span className="font-mono">access_logs</span> yet.
        </p>
      </div>
      <div className="mt-4 rounded-[22px] bg-white border border-forest-900/5 p-4 text-sm text-forest-800/80 leading-relaxed">
        <div className="eyebrow">When ESP32 arrives</div>
        <ol className="mt-2 list-decimal ml-5 space-y-1">
          <li>Flash firmware (BLE + RFID, offline buffer).</li>
          <li>Wire Flutter <span className="font-mono">syncLogs → Firestore access_logs</span>.</li>
          <li>This tab becomes a table: time · ref · granted/denied · reason + counts.</li>
        </ol>
      </div>
    </Screen>
  )
}
