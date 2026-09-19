import html
import xml.etree.ElementTree as ET

def build_drawio_xml():
    # Top-level mxfile
    mxfile = ET.Element('mxfile', {
        'host': 'app.diagrams.net',
        'modified': '2026-09-19T00:00:00.000Z',
        'agent': 'Hacienda-de-LuisAna/Architecture-v2',
        'version': '24.7.5',
        'type': 'device'
    })
    
    diagram = ET.SubElement(mxfile, 'diagram', {
        'id': 'hdl_system_architecture_v2',
        'name': 'HDL Complete System Architecture Flow v2'
    })
    
    model = ET.SubElement(diagram, 'mxGraphModel', {
        'dx': '2400',
        'dy': '1600',
        'grid': '1',
        'gridSize': '10',
        'guides': '1',
        'tooltips': '1',
        'connect': '1',
        'arrows': '1',
        'fold': '1',
        'page': '1',
        'pageScale': '1',
        'pageWidth': '2800',
        'pageHeight': '3700',
        'background': '#F8FAFC',
        'math': '0',
        'shadow': '0'
    })
    
    root = ET.SubElement(model, 'root')
    ET.SubElement(root, 'mxCell', {'id': '0'})
    ET.SubElement(root, 'mxCell', {'id': '1', 'parent': '0'})
    
    nodes = []
    edges = []
    
    def add_node(nid, label, x, y, w, h, style):
        nodes.append({
            'id': nid,
            'label': label,
            'x': x,
            'y': y,
            'w': w,
            'h': h,
            'style': style
        })
        
    def add_edge(eid, source, target, label='', style=''):
        edges.append({
            'id': eid,
            'source': source,
            'target': target,
            'label': label,
            'style': style
        })

    # STYLES
    S_SWIMLANE_BLUE = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#F0F9FF;strokeColor=#0284C7;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#0369A1;rounded=1;arcSize=3;"
    S_SWIMLANE_GREEN = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#F0FDF4;strokeColor=#16A34A;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#15803D;rounded=1;arcSize=3;"
    S_SWIMLANE_AMBER = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#FFFBEB;strokeColor=#D97706;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#B45309;rounded=1;arcSize=3;"
    S_SWIMLANE_PURPLE = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#FAF5FF;strokeColor=#9333EA;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#7E22CE;rounded=1;arcSize=3;"
    S_SWIMLANE_SLATE = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#F8FAFC;strokeColor=#475569;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#1E293B;rounded=1;arcSize=3;"
    S_SWIMLANE_INDIGO = "swimlane;whiteSpace=wrap;html=1;startSize=32;fillColor=#EEF2FF;strokeColor=#4F46E5;strokeWidth=2;fontStyle=1;fontSize=13;fontColor=#3730A3;rounded=1;arcSize=3;"

    S_START = "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#10B981;strokeColor=#059669;fontColor=#FFFFFF;fontStyle=1;fontSize=12;shadow=1;"
    S_END_OK = "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#059669;strokeColor=#047857;fontColor=#FFFFFF;fontStyle=1;fontSize=12;shadow=1;"
    S_END_ERR = "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#EF4444;strokeColor=#DC2626;fontColor=#FFFFFF;fontStyle=1;fontSize=12;shadow=1;"
    S_ACTION = "rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#94A3B8;fontColor=#0F172A;fontSize=12;strokeWidth=1.5;shadow=1;"
    S_ACTION_EMPH = "rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#EFF6FF;strokeColor=#3B82F6;fontColor=#1E3A8A;fontStyle=1;fontSize=12;strokeWidth=1.5;shadow=1;"
    S_DECISION = "rhombus;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;fontColor=#92400E;fontStyle=1;fontSize=11;strokeWidth=1.5;shadow=1;"
    S_DB = "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#E0E7FF;strokeColor=#4338CA;fontColor=#312E81;fontStyle=1;fontSize=12;shadow=1;"
    S_NOTE = "shape=note;whiteSpace=wrap;html=1;size=14;verticalAlign=top;align=left;spacing=8;fillColor=#FFFBEB;strokeColor=#F59E0B;fontColor=#78350F;fontSize=11;shadow=1;"

    S_EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#64748B;strokeWidth=1.5;fontColor=#334155;fontSize=11;"
    S_EDGE_OK = S_EDGE_YES = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#10B981;strokeWidth=1.8;fontColor=#065F46;fontSize=11;fontStyle=1;"
    S_EDGE_NO = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#EF4444;strokeWidth=1.8;fontColor=#991B1B;fontSize=11;fontStyle=1;"
    S_EDGE_DASH = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#6366F1;strokeWidth=1.5;strokeFactor=1;dashed=1;dashPattern=5 5;fontColor=#4338CA;fontSize=10;"
    S_EDGE_CROSS = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#0284C7;strokeWidth=2.2;fontColor=#0369A1;fontSize=11;fontStyle=1;"

    # 0. HEADER & GLOBAL CONVENTIONS LEGEND
    add_node('BANNER_HEADER',
             '<b>HACIENDA DE LUISANA RESORT &amp; ESTATE</b><br/>'
             '<font style="font-size: 16px;"><b>Property Management, Smart Lock (RFID + Mobile Key / ESP32) &amp; Live Tracking System Flow</b></font><br/>'
             '<font color="#64748B">System Architectural Flowchart v2 — Unified Production Specification</font>',
             40, 40, 1500, 75,
             'rounded=1;arcSize=6;whiteSpace=wrap;html=1;fillColor=#0F172A;strokeColor=#0F172A;fontColor=#FFFFFF;fontSize=18;align=left;spacingLeft=25;shadow=1;')
    
    legend_html = (
        '<b>GLOBAL CONVENTIONS (System Rules v2):</b><br/>'
        '• <b>G1 — No Dangling ENDs:</b> Every terminal sets final status + releases held dates + notifies customer + writes Activity Log.<br/>'
        '• <b>G2 — Enforced Availability:</b> System DB overlap check at submit <i>and</i> at approval (not eyeball-only).<br/>'
        '• <b>G3 — Money Last:</b> Approve booking &amp; KYC <i>before</i> payment collection; verified money touched only via Refund pipeline.<br/>'
        '• <b>G4 — 24h TTL:</b> Any booking in a pending stage for 24 hours auto-expires (EXPIRED → release dates → notify).<br/>'
        '• <b>G5 — One Credential Pipeline:</b> RFID card &amp; BLE Mobile Key share the same verification checklist &amp; offline cache.<br/>'
        '• <b>G6 — Consent-Gated Tracking:</b> Guest GPS tracking requires active consent (RA 10173); auto-purges N days post checkout.<br/>'
        '• <b>G7 — Central DB Auditing:</b> Every state change writes timestamp, operator, and entity payload to Central DB.'
    )
    add_node('LEGEND_BOX', legend_html, 1560, 40, 1140, 150, S_NOTE)

    # 1. INITIAL AUTHENTICATION & ROLE ROUTING
    add_node('SUBGRAPH_AUTH', '1. INITIAL AUTHENTICATION &amp; ROLE ROUTING', 40, 220, 500, 740, S_SWIMLANE_BLUE)
    add_node('START', 'START<br/>Open System (Web / App)', 170, 260, 240, 45, S_START)
    add_node('INPUT', 'Input: Register or Login<br/><font color="#64748B">(Register = Customer Only; Staff/Admin Provisioned)</font>', 160, 330, 260, 50, S_ACTION)
    add_node('STATUS', 'Account Status<br/>ACTIVE?', 215, 410, 150, 70, S_DECISION)
    add_node('DENYLOGIN', 'Login Not Allowed<br/>(Inactive / Archived)<br/>Notify: Contact Administrator', 70, 510, 180, 55, S_ACTION)
    # END1 was MISSING, DENYLOGIN edge was pointing back to STATUS! Fixed:
    add_node('END1', 'END 1<br/>(Access Denied)', 70, 600, 180, 45, S_END_ERR)
    add_node('ROLE', 'Identify User Role', 290, 510, 160, 60, S_DECISION)
    add_node('ROLE_NOTE', '<b>Role Routing:</b><br/>• Customer → Booker Flow<br/>• Staff → Operations Portal<br/>• Admin → Management Portal<br/>• Super Admin → System Controls', 160, 680, 260, 70, S_NOTE)

    add_edge('e1_1', 'START', 'INPUT', '', S_EDGE)
    add_edge('e1_2', 'INPUT', 'STATUS', '', S_EDGE)
    add_edge('e1_3', 'STATUS', 'DENYLOGIN', 'No', S_EDGE_NO)
    # Miswired edge fixed: DENYLOGIN -> END1 (was DENYLOGIN -> STATUS)
    add_edge('e1_4', 'DENYLOGIN', 'END1', '', S_EDGE_NO)
    add_edge('e1_5', 'STATUS', 'ROLE', 'Yes', S_EDGE_YES)

    # 2. CUSTOMER / USER MODULE FLOW (Approve First, Pay After, KYC, TTL)
    add_node('SUBGRAPH_CUSTOMER', '2. CUSTOMER / BOOKER MODULE FLOW (Approve First, Pay After, KYC, 24h TTL)', 580, 220, 700, 2400, S_SWIMLANE_GREEN)
    add_node('CUST_DASH', 'Customer Dashboard<br/>View Accommodations &amp; Search', 770, 260, 320, 50, S_ACTION)
    add_node('PROP_AVAIL', 'Property Available?<br/><font color="#64748B">(System Date-Overlap Check)</font>', 830, 335, 200, 70, S_DECISION)
    add_node('DATE_INPUT', 'Input: Select Check-in, Check-out<br/>&amp; Number of Guests', 800, 430, 260, 50, S_ACTION)
    add_node('VAL_DATES', 'Dates Valid &amp;<br/>Guests ≤ Capacity?', 850, 505, 160, 70, S_DECISION)
    add_node('NOTIFY_VAL', 'Notify Customer:<br/>Adjust Dates or Guest Count', 610, 515, 200, 50, S_ACTION)
    add_node('SUBMIT_BOOK', 'Submit Booking Request', 830, 600, 200, 45, S_ACTION)
    add_node('SET_PENDING', 'Set Booking = <b>PENDING</b><br/>Apply <b>24h TTL Hold</b> on Dates (G4)<br/>Save to Central DB &amp; Notify Admin', 780, 670, 300, 60, S_ACTION_EMPH)
    add_node('UPLOAD_KYC', 'Customer Uploads Valid Government ID<br/>Set KYC = <b>SUBMITTED</b> (Central DB)', 780, 755, 300, 50, S_ACTION)
    add_node('ADMIN_REVIEW', 'Admin / Super Admin Review<br/>Booking Details &amp; KYC Verification', 800, 830, 260, 50, S_ACTION)
    add_node('SYS_RECHECK', 'System Auto Re-check:<br/>Dates Still Free? (G2)', 830, 905, 200, 70, S_DECISION)
    add_node('SUGGEST_ALT', 'Suggest Alternative Dates<br/>Notify Customer via App/Email', 610, 915, 190, 50, S_ACTION)
    add_node('REBOOK_DEC', 'Customer Accepts<br/>Alternative Dates?', 630, 990, 150, 60, S_DECISION)
    add_node('REJECT_BOOK1', 'Set Booking = <b>REJECTED</b><br/>Release Held Dates<br/>Notify Customer &amp; Write Log (G1)', 610, 1080, 190, 60, S_ACTION)
    add_node('END_REJECT1', 'END (Rejected: Overlap)', 610, 1165, 190, 40, S_END_ERR)

    add_node('ID_VALID', 'Government ID<br/>(KYC) Valid?', 850, 1000, 160, 70, S_DECISION)
    add_node('NOTIFY_KYC', 'Notify Customer: Re-upload ID<br/>(Within 24h TTL Window)', 610, 1235, 190, 50, S_ACTION)
    add_node('RESUBMIT_KYC', 'Customer Resubmits<br/>within TTL?', 630, 1310, 150, 60, S_DECISION)
    add_node('REJECT_BOOK2', 'Set Booking = <b>REJECTED</b><br/>Release Held Dates<br/>Notify Customer &amp; Log (G1)', 610, 1395, 190, 60, S_ACTION)
    add_node('END_REJECT2', 'END (Rejected: KYC)', 610, 1480, 190, 40, S_END_ERR)

    add_node('SET_APPROVED', 'Set Booking = <b>APPROVED</b><br/>(Dates Firmly Held — G3 Money Last)<br/>Notify Customer: Proceed to Payment', 780, 1100, 300, 60, S_ACTION_EMPH)
    add_node('PAY_SELECT', 'Customer Selects Payment Option:<br/>[50% Down Payment + Deposit] OR<br/>[Full Payment + Deposit]', 780, 1185, 300, 55, S_ACTION)
    add_node('UPLOAD_PAY', 'Customer Uploads Payment Proof<br/>Set Payment = <b>PENDING</b>', 800, 1265, 260, 50, S_ACTION)
    add_node('VERIFY_PAY', 'Admin / Super Admin Verifies Payment Proof<br/>Against Official Bank / Gateway Records', 780, 1340, 300, 50, S_ACTION)
    add_node('PAY_VALID', 'Payment Proof<br/>Valid &amp; Verified?', 850, 1415, 160, 70, S_DECISION)
    add_node('REJECT_PAY', 'Reject Payment &amp; Notify Customer<br/>(Within 24h TTL Window)', 610, 1545, 190, 50, S_ACTION)
    add_node('RESUBMIT_PAY', 'Customer Resubmits<br/>Proof within TTL?', 630, 1620, 150, 60, S_DECISION)
    add_node('CANCEL_PAY', 'Set Booking = <b>CANCELLED</b><br/>Release Dates &amp; Notify Customer<br/>(No Money Verified — No Refund)', 610, 1705, 190, 65, S_ACTION)
    add_node('END_CANCEL1', 'END (Unpaid Cancelled)', 610, 1795, 190, 40, S_END_ERR)

    add_node('PAY_VERIFIED', 'Set Payment = <b>VERIFIED</b><br/>Set Booking = <b>RESERVED</b><br/>Save to Central DB &amp; Notify Customer', 780, 1515, 300, 60, S_ACTION_EMPH)
    add_node('CREATE_TRACK', 'Create Booking Tracking Record<br/>Generate Tracking ID &amp; QR Voucher', 800, 1600, 260, 50, S_ACTION)
    add_node('ASSIGN_CRED', 'Provision &amp; Assign Guest Credentials:<br/><b>RFID Card / Tag UID</b> + <b>In-App Mobile Key (BLE)</b>', 770, 1675, 320, 55, S_ACTION_EMPH)

    # TTL Expiry Node
    add_node('TTL_TIMER', '<b>24h TTL Timer Expires</b><br/>(Any Pending Booking Inactive for 24h — G4)', 1010, 1755, 250, 50, S_ACTION)
    add_node('EXPIRE_BKG', 'Set Booking = <b>EXPIRED</b><br/>Release Held Dates<br/>Notify Customer &amp; Admin (G1)', 1010, 1830, 250, 60, S_ACTION)
    add_node('END_EXPIRED', 'END (Auto-Expired)', 1040, 1915, 190, 40, S_END_ERR)

    # Post-Payment Refund Pipeline (Fixes Refund Hole)
    add_node('CUST_CANCEL', 'Customer Requests Cancellation<br/>(From Dashboard)', 790, 1755, 200, 50, S_ACTION)
    add_node('CANCEL_STATUS', 'Booking Stage<br/>at Cancel Request?', 815, 1830, 150, 65, S_DECISION)
    add_node('CANCEL_PRE_PAY', 'Pre-Payment Stage (Pending/Approved):<br/>Set <b>CANCELLED</b> → Release Dates → Notify Admin', 610, 1920, 210, 60, S_ACTION)
    add_node('END_CANCEL2', 'END (Pre-Payment Cancel)', 610, 2005, 210, 40, S_END_ERR)
    add_node('ADMIN_REFUND_REV', 'Post-Payment Stage (RESERVED):<br/>Admin Reviews per Cancellation Policy', 850, 1920, 210, 60, S_ACTION)
    add_node('REFUND_DEC', 'Refund Approved<br/>per Policy?', 880, 2005, 150, 65, S_DECISION)
    add_node('REFUND_EXEC', 'Set Booking = <b>CANCELLED</b><br/>Release Held Dates<br/><b>Initiate &amp; Execute Refund</b><br/>(Deposit + Policy-based Rate)<br/>Set Status = <b>REFUNDED</b> &amp; Notify', 760, 2100, 260, 90, S_ACTION_EMPH)
    add_node('END_REFUND', 'END (Refund Processed)', 795, 2215, 190, 40, S_END_OK)
    add_node('REFUND_DENY', 'Refund Denied per Non-Refundable Policy<br/>Booking Remains <b>RESERVED</b><br/>Notify Customer Policy Justification', 1040, 2100, 220, 70, S_ACTION)
    add_node('END_DENY_CANCEL', 'END (Booking Retained)', 1055, 2200, 190, 40, S_END_OK)

    # Customer Edges
    add_edge('ec_1', 'CUST_DASH', 'PROP_AVAIL', '', S_EDGE)
    add_edge('ec_2', 'PROP_AVAIL', 'CUST_DASH', 'No (Search Again)', S_EDGE_NO)
    add_edge('ec_3', 'PROP_AVAIL', 'DATE_INPUT', 'Yes', S_EDGE_YES)
    add_edge('ec_4', 'DATE_INPUT', 'VAL_DATES', '', S_EDGE)
    add_edge('ec_5', 'VAL_DATES', 'NOTIFY_VAL', 'No', S_EDGE_NO)
    add_edge('ec_6', 'NOTIFY_VAL', 'DATE_INPUT', '', S_EDGE)
    add_edge('ec_7', 'VAL_DATES', 'SUBMIT_BOOK', 'Yes', S_EDGE_YES)
    add_edge('ec_8', 'SUBMIT_BOOK', 'SET_PENDING', '', S_EDGE)
    add_edge('ec_9', 'SET_PENDING', 'UPLOAD_KYC', '', S_EDGE)
    add_edge('ec_10', 'UPLOAD_KYC', 'ADMIN_REVIEW', '', S_EDGE)
    add_edge('ec_11', 'ADMIN_REVIEW', 'SYS_RECHECK', '', S_EDGE)
    add_edge('ec_12', 'SYS_RECHECK', 'SUGGEST_ALT', 'No', S_EDGE_NO)
    add_edge('ec_13', 'SUGGEST_ALT', 'REBOOK_DEC', '', S_EDGE)
    add_edge('ec_14', 'REBOOK_DEC', 'DATE_INPUT', 'Yes (Rebook)', S_EDGE_YES)
    add_edge('ec_15', 'REBOOK_DEC', 'REJECT_BOOK1', 'No', S_EDGE_NO)
    add_edge('ec_16', 'REJECT_BOOK1', 'END_REJECT1', '', S_EDGE_NO)
    add_edge('ec_17', 'SYS_RECHECK', 'ID_VALID', 'Yes', S_EDGE_YES)
    add_edge('ec_18', 'ID_VALID', 'NOTIFY_KYC', 'No', S_EDGE_NO)
    add_edge('ec_19', 'NOTIFY_KYC', 'RESUBMIT_KYC', '', S_EDGE)
    add_edge('ec_20', 'RESUBMIT_KYC', 'UPLOAD_KYC', 'Yes', S_EDGE_YES)
    add_edge('ec_21', 'RESUBMIT_KYC', 'REJECT_BOOK2', 'No', S_EDGE_NO)
    add_edge('ec_22', 'REJECT_BOOK2', 'END_REJECT2', '', S_EDGE_NO)
    add_edge('ec_23', 'ID_VALID', 'SET_APPROVED', 'Yes', S_EDGE_YES)
    add_edge('ec_24', 'SET_APPROVED', 'PAY_SELECT', '', S_EDGE)
    add_edge('ec_25', 'PAY_SELECT', 'UPLOAD_PAY', '', S_EDGE)
    add_edge('ec_26', 'UPLOAD_PAY', 'VERIFY_PAY', '', S_EDGE)
    add_edge('ec_27', 'VERIFY_PAY', 'PAY_VALID', '', S_EDGE)
    add_edge('ec_28', 'PAY_VALID', 'REJECT_PAY', 'No', S_EDGE_NO)
    add_edge('ec_29', 'REJECT_PAY', 'RESUBMIT_PAY', '', S_EDGE)
    add_edge('ec_30', 'RESUBMIT_PAY', 'UPLOAD_PAY', 'Yes', S_EDGE_YES)
    add_edge('ec_31', 'RESUBMIT_PAY', 'CANCEL_PAY', 'No', S_EDGE_NO)
    add_edge('ec_32', 'CANCEL_PAY', 'END_CANCEL1', '', S_EDGE_NO)
    add_edge('ec_33', 'PAY_VALID', 'PAY_VERIFIED', 'Yes', S_EDGE_YES)
    add_edge('ec_34', 'PAY_VERIFIED', 'CREATE_TRACK', '', S_EDGE)
    add_edge('ec_35', 'CREATE_TRACK', 'ASSIGN_CRED', '', S_EDGE)
    add_edge('ec_36', 'SET_PENDING', 'TTL_TIMER', '24h Timer', S_EDGE_DASH)
    add_edge('ec_37', 'TTL_TIMER', 'EXPIRE_BKG', '', S_EDGE_NO)
    add_edge('ec_38', 'EXPIRE_BKG', 'END_EXPIRED', '', S_EDGE_NO)
    add_edge('ec_39', 'CUST_CANCEL', 'CANCEL_STATUS', '', S_EDGE)
    add_edge('ec_40', 'CANCEL_STATUS', 'CANCEL_PRE_PAY', 'Pending/Approved', S_EDGE)
    add_edge('ec_41', 'CANCEL_PRE_PAY', 'END_CANCEL2', '', S_EDGE_NO)
    add_edge('ec_42', 'CANCEL_STATUS', 'ADMIN_REFUND_REV', 'Reserved', S_EDGE)
    add_edge('ec_43', 'ADMIN_REFUND_REV', 'REFUND_DEC', '', S_EDGE)
    add_edge('ec_44', 'REFUND_DEC', 'REFUND_EXEC', 'Yes', S_EDGE_YES)
    add_edge('ec_45', 'REFUND_EXEC', 'END_REFUND', '', S_EDGE_OK)
    add_edge('ec_46', 'REFUND_DEC', 'REFUND_DENY', 'No', S_EDGE_NO)
    add_edge('ec_47', 'REFUND_DENY', 'END_DENY_CANCEL', '', S_EDGE_OK)

    # 3. RFID / MOBILE KEY SMART LOCK + ESP32 MODULE FLOW
    # Entire subgraph was MISSING from user diagram! Restoring in full:
    add_node('SUBGRAPH_LOCK', '3. RFID SMART LOCK + ESP32 MODULE FLOW (Dual Credential &amp; Offline Mode)', 1320, 220, 680, 1150, S_SWIMLANE_PURPLE)
    add_node('CHECKIN_TRIGGER', 'CHECK-IN TIME REACHED (2:00 PM)<br/>Guest Arrives at Villa / Casita', 1510, 260, 300, 45, S_START)
    add_node('PRESENT_CRED', 'Customer Presents <b>RFID Card/Tag</b><br/>OR Taps <b>Mobile Key</b> in App via BLE (G5)', 1500, 330, 320, 50, S_ACTION)
    add_node('ESP32_SCAN', 'RFID Reader Scans UID /<br/>ESP32 Receives Signed Mobile Key Token', 1510, 405, 300, 50, S_ACTION)
    add_node('SEND_CRED', 'Send Credential to Verification Engine<br/>Log Event to Central DB<br/><i>(Offline Mode: Local Cached Token Fallback)</i>', 1490, 480, 340, 60, S_ACTION)
    add_node('VERIFY_CRED', 'Verify Credential:<br/>Customer + Booking + Property +<br/>Payment + Account + Dates + Status?', 1540, 565, 240, 80, S_DECISION)
    add_node('SAVE_FAIL_LOG', 'Save Failed Access Log<br/>(Central DB / Offline Buffer)', 1350, 670, 200, 50, S_ACTION)
    add_node('FAIL_COUNT', '≥ 3 Failures within<br/>10 Minutes?', 1375, 745, 150, 65, S_DECISION)
    add_node('ALERT_LOCKOUT', 'Alert Admin via Push/SMS<br/>Trigger <b>15-Minute Lockout</b> Cooldown', 1350, 835, 200, 55, S_ACTION)
    add_node('DENY_ACCESS', 'Deny Access<br/>(Audible Beep &amp; Red LED)', 1570, 755, 180, 45, S_ACTION)
    add_node('END_ACCESS', 'END ACCESS', 1475, 915, 150, 40, S_END_ERR)

    add_node('ESP32_UNLOCK', 'ESP32 Unlocks Solenoid / Deadbolt<br/>Audible Chime &amp; Green LED Pulse', 1670, 670, 280, 50, S_ACTION_EMPH)
    add_node('SAVE_SUCCESS_LOG', 'Save Successful Access Log<br/>(Central DB Access History)', 1690, 745, 240, 45, S_ACTION)
    add_node('FIRST_UNLOCK', 'First Successful Unlock<br/>on Check-in Day?', 1720, 815, 180, 70, S_DECISION)
    add_node('SET_CHECKEDIN', 'Set Booking = <b>CHECKED-IN</b><br/>Notify Admin: "Guest Has Arrived"', 1670, 915, 280, 50, S_ACTION_EMPH)
    add_node('SET_STAYING', 'Set Booking = <b>STAYING</b><br/>Activate Authorized In-Stay State', 1690, 990, 240, 50, S_ACTION_EMPH)
    add_node('STAY_BEGINS', 'Customer Stay Begins<br/>Proceed to Authorized Location Tracking', 1680, 1065, 260, 50, S_ACTION)

    add_edge('el_1', 'CHECKIN_TRIGGER', 'PRESENT_CRED', '', S_EDGE)
    add_edge('el_2', 'PRESENT_CRED', 'ESP32_SCAN', '', S_EDGE)
    add_edge('el_3', 'ESP32_SCAN', 'SEND_CRED', '', S_EDGE)
    add_edge('el_4', 'SEND_CRED', 'VERIFY_CRED', '', S_EDGE)
    add_edge('el_5', 'VERIFY_CRED', 'SAVE_FAIL_LOG', 'No', S_EDGE_NO)
    add_edge('el_6', 'SAVE_FAIL_LOG', 'FAIL_COUNT', '', S_EDGE)
    add_edge('el_7', 'FAIL_COUNT', 'ALERT_LOCKOUT', 'Yes', S_EDGE_NO)
    add_edge('el_8', 'ALERT_LOCKOUT', 'END_ACCESS', '', S_EDGE_NO)
    add_edge('el_9', 'FAIL_COUNT', 'DENY_ACCESS', 'No', S_EDGE)
    add_edge('el_10', 'DENY_ACCESS', 'END_ACCESS', '', S_EDGE_NO)
    add_edge('el_11', 'VERIFY_CRED', 'ESP32_UNLOCK', 'Yes', S_EDGE_YES)
    add_edge('el_12', 'ESP32_UNLOCK', 'SAVE_SUCCESS_LOG', '', S_EDGE)
    add_edge('el_13', 'SAVE_SUCCESS_LOG', 'FIRST_UNLOCK', '', S_EDGE)
    add_edge('el_14', 'FIRST_UNLOCK', 'SET_CHECKEDIN', 'Yes', S_EDGE_YES)
    add_edge('el_15', 'SET_CHECKEDIN', 'SET_STAYING', '', S_EDGE)
    add_edge('el_16', 'FIRST_UNLOCK', 'SET_STAYING', 'No (Subsequent Unlock)', S_EDGE)
    add_edge('el_17', 'SET_STAYING', 'STAY_BEGINS', '', S_EDGE)

    # 4. GUEST LOCATION TRACKING MODULE FLOW (Consent-Gated)
    add_node('SUBGRAPH_TRACKING', '4. GUEST LOCATION TRACKING MODULE FLOW (Consent-Gated &amp; RA 10173)', 2040, 220, 660, 940, S_SWIMLANE_INDIGO)
    add_node('TRACK_CONSENT', 'Guest Consented to<br/>Location Tracking?<br/><font color="#64748B">(Data Privacy Act / RA 10173)</font>', 2270, 260, 200, 75, S_DECISION)
    add_node('TRACK_DISABLED', 'Tracking = <b>DISABLED</b><br/>(Smart Lock &amp; RFID access logs only)<br/>Respect Privacy Choice', 2060, 365, 220, 60, S_ACTION)
    add_node('TRACK_ENABLED', 'Tracking = <b>ENABLED</b><br/>(Active during authorized stay period only)', 2370, 365, 240, 50, S_ACTION_EMPH)
    add_node('GET_LOC', 'Mobile App Fetches Booker Location<br/>(Background GPS / Geofence Beacon)', 2370, 440, 240, 50, S_ACTION)
    add_node('RECORD_LOC', 'Record Telemetry:<br/>GPS Lat/Long, Accuracy, Timestamp, Municipality', 2360, 515, 260, 50, S_ACTION)
    add_node('SAVE_LOC_DB', 'Save Location History to Central DB<br/><i>(Encrypted at Rest, Access-Logged)</i>', 2370, 590, 240, 50, S_ACTION)
    add_node('VIEW_LOC', 'Admin &amp; Super Admin View Authorized Radar<br/>(Role-Restricted; Every View is Audited)', 2360, 665, 260, 50, S_ACTION)
    add_node('STILL_STAYING', 'Guest Still Staying?<br/>(Check-out Not Passed)', 2405, 740, 170, 65, S_DECISION)
    add_node('STOP_TRACK', 'Stop Location Tracking<br/>Record Final Location Timestamp', 2370, 830, 240, 45, S_ACTION)
    add_node('WAIT_CHECKOUT', 'Proceed to Check-Out Flow', 2080, 745, 200, 45, S_ACTION)
    add_node('PURGE_RULE', '<b>Retention &amp; Purge Engine:</b><br/>Auto-Purge Location History N Days Post Check-Out<br/>Write Purge Audit Log (G6)', 2190, 895, 360, 50, S_ACTION_EMPH)

    add_edge('et_1', 'TRACK_CONSENT', 'TRACK_DISABLED', 'No Consent', S_EDGE_NO)
    add_edge('et_2', 'TRACK_CONSENT', 'TRACK_ENABLED', 'Yes Consented', S_EDGE_YES)
    add_edge('et_3', 'TRACK_DISABLED', 'WAIT_CHECKOUT', '', S_EDGE)
    add_edge('et_4', 'TRACK_ENABLED', 'GET_LOC', '', S_EDGE)
    add_edge('et_5', 'GET_LOC', 'RECORD_LOC', '', S_EDGE)
    add_edge('et_6', 'RECORD_LOC', 'SAVE_LOC_DB', '', S_EDGE)
    add_edge('et_7', 'SAVE_LOC_DB', 'VIEW_LOC', '', S_EDGE)
    add_edge('et_8', 'VIEW_LOC', 'STILL_STAYING', '', S_EDGE)
    add_edge('et_9', 'STILL_STAYING', 'GET_LOC', 'Yes (Stay Ongoing)', S_EDGE_YES)
    add_edge('et_10', 'STILL_STAYING', 'STOP_TRACK', 'No (Departing)', S_EDGE_NO)
    add_edge('et_11', 'STOP_TRACK', 'WAIT_CHECKOUT', '', S_EDGE)
    add_edge('et_12', 'WAIT_CHECKOUT', 'PURGE_RULE', '', S_EDGE)

    # 5. CHECK-OUT, DAMAGE, SECURITY DEPOSIT & CLEANING FLOW
    add_node('SUBGRAPH_CHECKOUT', '5. CHECK-OUT, DAMAGE, CLEANING &amp; INSPECTION FLOW', 1320, 1400, 680, 1220, S_SWIMLANE_AMBER)
    add_node('CHECKOUT', 'CHECK-OUT TIME REACHED (12:00 NN)<br/>Guest Departs Property', 1510, 1440, 300, 45, S_START)
    add_node('ESP32_LOCK', 'ESP32 Engages Lock<br/>Set Credential Status = <b>INACTIVE</b>', 1520, 1510, 280, 50, S_ACTION)
    add_node('SAVE_CHECKOUT_LOG', 'Save Check-out Access Log<br/>Set Booking = <b>CHECKED-OUT</b><br/>Notify Customer: Check-out Acknowledged', 1500, 1585, 320, 60, S_ACTION_EMPH)
    add_node('CREATE_CLEAN_TASK', 'Create Cleaning Task<br/>Auto-Assign Staff / Caretaker', 1520, 1670, 280, 45, S_ACTION)
    add_node('DAMAGE_CHECK', 'Damage Reported?<br/><font color="#64748B">(Staff Inspection or Guest Self-Report)</font>', 1555, 1740, 210, 70, S_DECISION)
    add_node('SUBMIT_DAMAGE', 'Select Damaged Item &amp; Description<br/>Upload Photo / Video Evidence<br/>Submit Damage Report to Central DB', 1350, 1835, 280, 60, S_ACTION)
    add_node('ADMIN_VERIFY_DMG', 'Admin / Super Admin Review<br/>Damage Evidence &amp; Repair Estimate', 1360, 1920, 260, 50, S_ACTION)
    add_node('DMG_VERIFIED', 'Damage Verified<br/>&amp; Chargeable?', 1400, 1995, 180, 65, S_DECISION)
    add_node('CLOSE_DAMAGE', 'Close Damage Report<br/>(Normal Wear &amp; Tear / Disallowed)', 1350, 2085, 230, 50, S_ACTION)
    add_node('SET_DMG_VERIFIED', 'Set Damage = <b>VERIFIED</b><br/>Create Maintenance Work Order', 1600, 2085, 240, 50, S_ACTION)
    add_node('SETTLE_DEPOSIT', '<b>Security Deposit Settlement:</b><br/>Deduct Repair Cost from Deposit<br/>Refund Remaining Deposit to Customer', 1580, 2160, 280, 60, S_ACTION_EMPH)
    add_node('REPAIR_ITEM', 'Repair or Replace Damaged Item<br/>Update Maintenance Status to Fixed', 1600, 2245, 240, 50, S_ACTION)

    add_node('STAFF_CLEAN', 'Staff or Caretaker Cleans Accommodation<br/>Sanitization, Linen Change, Restock', 1500, 2320, 320, 50, S_ACTION)
    add_node('CLEAN_DONE', 'Cleaning<br/>Complete?', 1580, 2395, 160, 60, S_DECISION)
    add_node('PROP_INSPECT', 'Property Inspection Conducted<br/>By Head Staff / Admin', 1530, 2480, 260, 45, S_ACTION)
    add_node('INSPECT_READY', 'Clean and Ready<br/>for Next Guest?', 1580, 2550, 160, 65, S_DECISION)
    add_node('MAINT_REPAIR', 'Maintenance Rectification<br/>&amp; Re-cleaning', 1350, 2555, 190, 50, S_ACTION)
    add_node('SET_AVAILABLE', 'Set Property = <b>AVAILABLE</b><br/>(Dates Rejoin Booking Pool Only Now — G1)', 1750, 2550, 240, 60, S_ACTION_EMPH)
    add_node('SAVE_RECORDS', 'Save Cleaning, Maintenance, Damage &amp;<br/>Inspection Records to Central DB', 1510, 2640, 300, 50, S_ACTION)
    add_node('SET_COMPLETED', 'Set Booking = <b>COMPLETED</b><br/>Notify Customer: Thank You + Final Deposit Statement', 1490, 2715, 340, 55, S_ACTION_EMPH)
    add_node('GEN_REPORTS', 'Generate Operational &amp; Financial Reports', 1540, 2795, 240, 45, S_ACTION)
    add_node('END_FLOW', 'END (Lifecycle Complete)', 1565, 2865, 190, 40, S_END_OK)

    add_edge('e5_1', 'CHECKOUT', 'ESP32_LOCK', '', S_EDGE)
    add_edge('e5_2', 'ESP32_LOCK', 'SAVE_CHECKOUT_LOG', '', S_EDGE)
    add_edge('e5_3', 'SAVE_CHECKOUT_LOG', 'CREATE_CLEAN_TASK', '', S_EDGE)
    add_edge('e5_4', 'CREATE_CLEAN_TASK', 'DAMAGE_CHECK', '', S_EDGE)
    add_edge('e5_5', 'DAMAGE_CHECK', 'SUBMIT_DAMAGE', 'Yes', S_EDGE_NO)
    add_edge('e5_6', 'DAMAGE_CHECK', 'STAFF_CLEAN', 'No', S_EDGE_YES)
    add_edge('e5_7', 'SUBMIT_DAMAGE', 'ADMIN_VERIFY_DMG', '', S_EDGE)
    add_edge('e5_8', 'ADMIN_VERIFY_DMG', 'DMG_VERIFIED', '', S_EDGE)
    add_edge('e5_9', 'DMG_VERIFIED', 'CLOSE_DAMAGE', 'No', S_EDGE_NO)
    add_edge('e5_10', 'CLOSE_DAMAGE', 'STAFF_CLEAN', '', S_EDGE)
    add_edge('e5_11', 'DMG_VERIFIED', 'SET_DMG_VERIFIED', 'Yes', S_EDGE_YES)
    add_edge('e5_12', 'SET_DMG_VERIFIED', 'SETTLE_DEPOSIT', '', S_EDGE)
    add_edge('e5_13', 'SETTLE_DEPOSIT', 'REPAIR_ITEM', '', S_EDGE)
    add_edge('e5_14', 'REPAIR_ITEM', 'STAFF_CLEAN', '', S_EDGE)
    add_edge('e5_15', 'STAFF_CLEAN', 'CLEAN_DONE', '', S_EDGE)
    add_edge('e5_16', 'CLEAN_DONE', 'STAFF_CLEAN', 'No (Continue Cleaning)', S_EDGE_NO)
    add_edge('e5_17', 'CLEAN_DONE', 'PROP_INSPECT', 'Yes', S_EDGE_YES)
    add_edge('e5_18', 'PROP_INSPECT', 'INSPECT_READY', '', S_EDGE)
    add_edge('e5_19', 'INSPECT_READY', 'MAINT_REPAIR', 'No', S_EDGE_NO)
    add_edge('e5_20', 'MAINT_REPAIR', 'PROP_INSPECT', '', S_EDGE)
    add_edge('e5_21', 'INSPECT_READY', 'SET_AVAILABLE', 'Yes', S_EDGE_YES)
    add_edge('e5_22', 'SET_AVAILABLE', 'SAVE_RECORDS', '', S_EDGE)
    add_edge('e5_23', 'SAVE_RECORDS', 'SET_COMPLETED', '', S_EDGE)
    add_edge('e5_24', 'SET_COMPLETED', 'GEN_REPORTS', '', S_EDGE)
    add_edge('e5_25', 'GEN_REPORTS', 'END_FLOW', '', S_EDGE_OK)

    # 6. STAFF MODULE FLOW
    add_node('SUBGRAPH_STAFF', '6. STAFF MODULE FLOW (Operations &amp; Turnover)', 40, 990, 500, 670, S_SWIMLANE_SLATE)
    add_node('STAFF_DASH', 'Staff Dashboard Access', 190, 1030, 200, 45, S_ACTION)
    add_node('STAFF_ACTIVE', 'Staff Account<br/>Status ACTIVE?', 215, 1100, 150, 65, S_DECISION)
    add_node('STAFF_DENY', 'Login Denied<br/>(Contact Administrator)', 65, 1190, 170, 50, S_ACTION)
    add_node('END_STAFF1', 'END (Staff Denied)', 65, 1265, 170, 40, S_END_ERR)
    add_node('STAFF_OPS', '<b>Staff Operational Functions:</b><br/>• View Assigned Bookings &amp; Schedules<br/>• Manage Cleaning Work Orders<br/>• Manage Maintenance Repairs<br/>• Conduct Property Inspections<br/>• Submit Inspection Checklists &amp; Photos', 140, 1190, 300, 100, S_ACTION)
    add_node('STAFF_RESTRICT', '<font color="#991B1B"><b>Restrictions:</b><br/>Staff cannot manage accounts, verify payments,<br/>or approve bookings.</font>', 140, 1315, 300, 55, S_NOTE)
    add_node('STAFF_LOG', 'Save Staff Activity to Central Audit Log', 165, 1395, 250, 45, S_ACTION)
    add_node('END_STAFF2', 'END (Staff Session)', 200, 1465, 180, 40, S_END_OK)

    add_edge('es_1', 'STAFF_DASH', 'STAFF_ACTIVE', '', S_EDGE)
    add_edge('es_2', 'STAFF_ACTIVE', 'STAFF_DENY', 'No', S_EDGE_NO)
    add_edge('es_3', 'STAFF_DENY', 'END_STAFF1', '', S_EDGE_NO)
    add_edge('es_4', 'STAFF_ACTIVE', 'STAFF_OPS', 'Yes', S_EDGE_YES)
    add_edge('es_5', 'STAFF_OPS', 'STAFF_LOG', '', S_EDGE)
    add_edge('es_6', 'STAFF_LOG', 'END_STAFF2', '', S_EDGE_OK)

    # 7. ADMIN MODULE FLOW
    add_node('SUBGRAPH_ADMIN', '7. ADMIN MODULE FLOW (Operational Governance &amp; Controls)', 2040, 1190, 660, 720, S_SWIMLANE_BLUE)
    add_node('ADMIN_DASH', 'Admin Dashboard Access', 2270, 1230, 200, 45, S_ACTION)
    add_node('ADMIN_ACTIVE', 'Admin Account<br/>Status ACTIVE?', 2295, 1300, 150, 65, S_DECISION)
    add_node('ADMIN_DENY', 'Login Denied<br/>(Contact Super Admin)', 2060, 1390, 170, 50, S_ACTION)
    add_node('END_ADMIN1', 'END (Admin Denied)', 2060, 1465, 170, 40, S_END_ERR)
    add_node('ADMIN_OPS', '<b>Full Admin Capabilities:</b><br/>• Manage Users, Staff, Accommodations &amp; Bookings<br/>• Verify Customer Government ID (KYC) &amp; Payments<br/>• Approve / Reject Bookings (System overlap check - G2)<br/>• Process Refunds &amp; Security Deposit Deductions<br/>• Provision, Activate &amp; Deactivate RFID/Mobile Keys<br/>• View Credential Logs, Radar &amp; Authorized Locations<br/>• Track Activities, View Analytics &amp; Generate Reports<br/>• Disable, Enable, Soft-Archive or Restore Users/Staff', 2220, 1390, 300, 160, S_ACTION)
    add_node('ADMIN_RESTRICT', '<font color="#991B1B"><b>Restrictions:</b><br/>Cannot modify Super Admin accounts or restore other Admins.</font>', 2220, 1570, 300, 45, S_NOTE)
    add_node('ADMIN_LOG', 'Save Admin Actions to Central Activity Log', 2245, 1635, 250, 45, S_ACTION)
    add_node('END_ADMIN2', 'END (Admin Session)', 2280, 1705, 180, 40, S_END_OK)

    add_edge('ea_1', 'ADMIN_DASH', 'ADMIN_ACTIVE', '', S_EDGE)
    add_edge('ea_2', 'ADMIN_ACTIVE', 'ADMIN_DENY', 'No', S_EDGE_NO)
    add_edge('ea_3', 'ADMIN_DENY', 'END_ADMIN1', '', S_EDGE_NO)
    add_edge('ea_4', 'ADMIN_ACTIVE', 'ADMIN_OPS', 'Yes', S_EDGE_YES)
    add_edge('ea_5', 'ADMIN_OPS', 'ADMIN_LOG', '', S_EDGE)
    add_edge('ea_6', 'ADMIN_LOG', 'END_ADMIN2', '', S_EDGE_OK)

    # 8. SUPER ADMIN MODULE FLOW
    # Note: SAREPORT was BLANK in the user's diagram! Fixed here with full text:
    add_node('SUBGRAPH_SUPERADMIN', '8. SUPER ADMIN MODULE FLOW (Global System Authority &amp; Reports)', 2040, 1940, 660, 720, S_SWIMLANE_PURPLE)
    add_node('SADASH', 'Super Admin Dashboard<br/>(Status: <b>ALWAYS ACTIVE</b>)', 2250, 1980, 240, 45, S_START)
    add_node('SA_OPS', '<b>Super Admin Exclusive Powers:</b><br/>• All Full Admin Permissions<br/>• <b>Account Provisioning:</b> Create Admin &amp; Staff Accounts<br/>• Manage Admin Accounts (Disable, Enable, Archive, Restore)<br/>• Restore User, Staff, and Admin Accounts<br/>• System-wide Logs, Hardware Telemetry &amp; Financials<br/>• Global System &amp; Security Configuration', 2220, 2050, 300, 130, S_ACTION)
    add_node('SA_SELF_CHECK', 'Self-Action Check:<br/>Delete, Archive, or<br/>Disable Self?', 2295, 2200, 150, 75, S_DECISION)
    add_node('SA_SELF_DENIED', '<b>Action Denied &amp; Blocked:</b><br/>Super Admin cannot demote,<br/>archive, or delete self.', 2060, 2295, 210, 60, S_ACTION)
    add_node('SA_EXEC', 'Execute Authorized Administrative Action<br/>(Account Creation, Role Update, Policy Change)', 2230, 2300, 280, 50, S_ACTION)
    # RESTORED BLANK LABEL:
    add_node('SAREPORT', 'Generate System Reports<br/>(Financial, Turnover, Security &amp; Audit Reports)', 2240, 2375, 260, 50, S_ACTION_EMPH)
    add_node('SA_LOG', 'Save Action to System-wide Activity Log (Central DB)', 2230, 2450, 280, 45, S_ACTION)
    add_node('END_SA', 'END (Super Admin Session)', 2280, 2520, 180, 40, S_END_OK)

    add_edge('esa_1', 'SADASH', 'SA_OPS', '', S_EDGE)
    add_edge('esa_2', 'SA_OPS', 'SA_SELF_CHECK', '', S_EDGE)
    add_edge('esa_3', 'SA_SELF_CHECK', 'SA_SELF_DENIED', 'Yes (Self)', S_EDGE_NO)
    add_edge('esa_4', 'SA_SELF_DENIED', 'SADASH', 'Return to Panel', S_EDGE)
    add_edge('esa_5', 'SA_SELF_CHECK', 'SA_EXEC', 'No (Valid Target)', S_EDGE_YES)
    add_edge('esa_6', 'SA_EXEC', 'SAREPORT', '', S_EDGE)
    # SAREPORT connecting downstream:
    add_edge('esa_7', 'SAREPORT', 'SA_LOG', '', S_EDGE)
    add_edge('esa_8', 'SA_LOG', 'END_SA', '', S_EDGE_OK)

    # 9. ACCOUNT MANAGEMENT & SOFT ARCHIVE FLOW
    add_node('SUBGRAPH_ACCOUNT', '9. ACCOUNT MANAGEMENT &amp; SOFT ARCHIVE FLOW', 40, 1690, 500, 930, S_SWIMLANE_SLATE)
    add_node('PROV_FLOW', '<b>Account Provisioning:</b><br/>• Public Register → Customer Role Only<br/>• Admin Creates Staff Accounts<br/>• Super Admin Creates Admin Accounts<br/>• Save Provisioning Audit Log', 140, 1730, 300, 85, S_ACTION)
    add_node('ACC_DEL_REQ', 'User / Staff / Admin Requests Deletion<br/>OR Admin Initiates Archive Action', 150, 1840, 280, 50, S_ACTION)
    add_node('ACC_REVIEW', 'Admin / Super Admin Review Request', 170, 1915, 240, 45, S_ACTION)
    add_node('CHECK_ACTIVE_BKG', 'Account Has<br/>Active Bookings? (G1)', 215, 1985, 150, 65, S_DECISION)
    add_node('RESOLVE_BKG', 'Resolve, Transfer, or Cancel<br/>Active Bookings First (G1)', 65, 2075, 180, 55, S_ACTION)
    add_node('ARCHIVE_ACC', 'Soft Archive Account:<br/>Set Status = <b>ARCHIVED</b><br/>Revoke Login &amp; Move to Archive DB', 170, 2155, 240, 60, S_ACTION_EMPH)
    add_node('RESTORE_ACC', 'Restore Account<br/>Selected by Admin?', 215, 2240, 150, 65, S_DECISION)
    add_node('KEEP_ARCHIVED', 'Account Remains in Archived Database<br/>(Login Remains Blocked)', 65, 2330, 200, 55, S_ACTION)
    add_node('END_ARCHIVE1', 'END (Remains Archived)', 80, 2410, 170, 40, S_END_ERR)
    add_node('EXEC_RESTORE', 'Set Status = <b>ACTIVE</b><br/>Restore Login Permissions<br/>Write Restore Audit Log', 270, 2330, 220, 55, S_ACTION_EMPH)
    add_node('END_ARCHIVE2', 'END (Account Restored)', 295, 2410, 170, 40, S_END_OK)

    add_edge('eacc_1', 'PROV_FLOW', 'ACC_DEL_REQ', '', S_EDGE)
    add_edge('eacc_2', 'ACC_DEL_REQ', 'ACC_REVIEW', '', S_EDGE)
    add_edge('eacc_3', 'ACC_REVIEW', 'CHECK_ACTIVE_BKG', '', S_EDGE)
    add_edge('eacc_4', 'CHECK_ACTIVE_BKG', 'RESOLVE_BKG', 'Yes', S_EDGE_NO)
    add_edge('eacc_5', 'RESOLVE_BKG', 'ARCHIVE_ACC', '', S_EDGE)
    add_edge('eacc_6', 'CHECK_ACTIVE_BKG', 'ARCHIVE_ACC', 'No', S_EDGE_YES)
    add_edge('eacc_7', 'ARCHIVE_ACC', 'RESTORE_ACC', '', S_EDGE)
    add_edge('eacc_8', 'RESTORE_ACC', 'KEEP_ARCHIVED', 'No', S_EDGE_NO)
    add_edge('eacc_9', 'KEEP_ARCHIVED', 'END_ARCHIVE1', '', S_EDGE_NO)
    add_edge('eacc_10', 'RESTORE_ACC', 'EXEC_RESTORE', 'Yes', S_EDGE_YES)
    add_edge('eacc_11', 'EXEC_RESTORE', 'END_ARCHIVE2', '', S_EDGE_OK)

    # 10. CENTRAL DATABASE & ACTIVITY LOG ENGINE
    add_node('SUBGRAPH_DB', '10. CENTRAL DATABASE ENTITIES &amp; BOOKING TRACKING ENGINE', 40, 2650, 1240, 420, S_SWIMLANE_INDIGO)
    add_node('CENTRAL_DB', '<b>CENTRAL DATABASE &amp; STORAGE (Firestore / Cloud DB)</b><br/>'
                           '• Users, Government ID / KYC Verification Records, Staff, Admins, Super Admin<br/>'
                           '• Accommodations, Availability Calendar, 24h Date Holds (TTL Engine)<br/>'
                           '• Bookings, Payments, Payment Proofs, Refunds, Security Deposits<br/>'
                           '• Smart Lock Credentials (RFID Cards/Tags, Mobile Key BLE Tokens, Status)<br/>'
                           '• ESP32 Hardware Controls, Access Logs, Offline Log Buffer, Lockout Events<br/>'
                           '• Guest Locations, Location History (Encrypted), Consent Records, Purge Logs<br/>'
                           '• Damage Reports, Evidence Media, Maintenance Tasks, Cleaning, Inspections<br/>'
                           '• Account Requests, Archived Accounts DB, Provisioning Logs, System Notifications',
             70, 2700, 680, 180, S_DB)
    add_node('BOOKING_TRACKING', '<b>BOOKING STATUS LIFECYCLE STATE MACHINE:</b><br/>'
                                 '<b>Main Path:</b><br/>'
                                 'PENDING → KYC SUBMITTED → APPROVED → PAYMENT PENDING →<br/>'
                                 'PAYMENT VERIFIED → RESERVED → CHECKED-IN → STAYING →<br/>'
                                 'CHECKED-OUT → COMPLETED<br/><br/>'
                                 '<b>Terminal Branch States:</b><br/>'
                                 '• <b>REJECTED</b> (Availability overlap or KYC failure; dates released)<br/>'
                                 '• <b>CANCELLED</b> (Pre-payment or Host cancel; dates released)<br/>'
                                 '• <b>REFUNDED</b> (Post-payment cancel; deposit + refund policy executed)<br/>'
                                 '• <b>EXPIRED</b> (24h TTL timeout in any pending stage; dates released)',
             780, 2700, 470, 180, S_ACTION_EMPH)
    add_node('ACTIVITY_LOG', '<b>SYSTEM-WIDE ACTIVITY AUDIT TRAIL:</b><br/>'
                             'Every single mutation records: Timestamp, User ID, Role, IP Address, Action Performed, Entity, State Snapshot. Immutable write-once audit log.',
             70, 2900, 1180, 55, S_ACTION)

    # CROSS-SUBGRAPH EDGES (Wiring the entire architecture together cleanly!)
    # Auth routing to the 4 Dashboards:
    add_edge('cx_auth_cust', 'ROLE', 'CUST_DASH', 'Customer', S_EDGE_CROSS)
    add_edge('cx_auth_staff', 'ROLE', 'STAFF_DASH', 'Staff', S_EDGE_CROSS)
    add_edge('cx_auth_admin', 'ROLE', 'ADMIN_DASH', 'Admin', S_EDGE_CROSS)
    add_edge('cx_auth_sa', 'ROLE', 'SADASH', 'Super Admin', S_EDGE_CROSS)

    # Customer Flow to Smart Lock Flow:
    add_edge('cx_cust_lock', 'ASSIGN_CRED', 'CHECKIN_TRIGGER', 'Check-in Time Reached', S_EDGE_CROSS)

    # Smart Lock Flow to Location Tracking Flow:
    add_edge('cx_lock_track', 'STAY_BEGINS', 'TRACK_CONSENT', 'Stay Commences', S_EDGE_CROSS)

    # Location Tracking / Departure to Check-Out Flow:
    add_edge('cx_track_checkout', 'PURGE_RULE', 'CHECKOUT', 'Check-out & Credential Revoke', S_EDGE_CROSS)

    # Check-Out Completed to DB:
    add_edge('cx_clean_db', 'SET_AVAILABLE', 'CENTRAL_DB', 'Sync Availability', S_EDGE_DASH)
    add_edge('cx_track_db', 'CREATE_TRACK', 'BOOKING_TRACKING', 'Init Lifecycle', S_EDGE_DASH)

    # Convert nodes and edges to XML elements
    # 1. First add swimlanes/subgraphs so they are behind their children
    for n in nodes:
        if 'swimlane' in n['style']:
            c = ET.SubElement(root, 'mxCell', {
                'id': n['id'],
                'value': n['label'],
                'style': n['style'],
                'vertex': '1',
                'parent': '1'
            })
            ET.SubElement(c, 'mxGeometry', {
                'x': str(n['x']),
                'y': str(n['y']),
                'width': str(n['w']),
                'height': str(n['h']),
                'as': 'geometry'
            })

    # 2. Add regular nodes
    for n in nodes:
        if 'swimlane' not in n['style']:
            c = ET.SubElement(root, 'mxCell', {
                'id': n['id'],
                'value': n['label'],
                'style': n['style'],
                'vertex': '1',
                'parent': '1'
            })
            ET.SubElement(c, 'mxGeometry', {
                'x': str(n['x']),
                'y': str(n['y']),
                'width': str(n['w']),
                'height': str(n['h']),
                'as': 'geometry'
            })

    # 3. Add edges
    for e in edges:
        c = ET.SubElement(root, 'mxCell', {
            'id': e['id'],
            'value': e['label'],
            'style': e['style'],
            'edge': '1',
            'parent': '1',
            'source': e['source'],
            'target': e['target']
        })
        ET.SubElement(c, 'mxGeometry', {
            'relative': '1',
            'as': 'geometry'
        })
        
    # Return pretty XML string
    xml_str = ET.tostring(mxfile, encoding='utf-8')
    import xml.dom.minidom
    dom = xml.dom.minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent="  ")
    return pretty_xml, nodes, edges

def build_mermaid():
    m = """flowchart TD
    %% ==========================================
    %% GLOBAL STYLES & DEFINITIONS
    %% ==========================================
    classDef terminal fill:#10B981,stroke:#059669,stroke-width:2px,color:#fff,font-weight:bold;
    classDef terminalErr fill:#EF4444,stroke:#DC2626,stroke-width:2px,color:#fff,font-weight:bold;
    classDef decision fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#92400E,font-weight:bold;
    classDef process fill:#FFFFFF,stroke:#94A3B8,stroke-width:1.5px,color:#0F172A;
    classDef processEmph fill:#EFF6FF,stroke:#3B82F6,stroke-width:2px,color:#1E3A8A,font-weight:bold;
    classDef storage fill:#E0E7FF,stroke:#4338CA,stroke-width:2px,color:#312E81,font-weight:bold;

    %% ==========================================
    %% 1. INITIAL AUTHENTICATION & ROLE ROUTING
    %% ==========================================
    subgraph S1 ["1. INITIAL AUTHENTICATION & ROLE ROUTING"]
        START([START: Open System Web/App]):::terminal
        INPUT["Input: Register or Login<br/>(Register = Customer Only)"]:::process
        STATUS{"Account Status<br/>ACTIVE?"}:::decision
        DENYLOGIN["Login Not Allowed<br/>(Inactive / Archived)<br/>Notify Administrator"]:::process
        END1([END 1: Access Denied]):::terminalErr
        ROLE{"Identify User Role"}:::decision

        START --> INPUT
        INPUT --> STATUS
        STATUS -- No --> DENYLOGIN
        DENYLOGIN --> END1
        STATUS -- Yes --> ROLE
    end

    %% ==========================================
    %% 2. CUSTOMER / BOOKER FLOW (Approve First, Pay After, KYC, TTL)
    %% ==========================================
    subgraph S2 ["2. CUSTOMER / BOOKER MODULE FLOW (Approve First, Pay After, KYC, 24h TTL)"]
        CUST_DASH["Customer Dashboard<br/>Browse Accommodations"]:::process
        PROP_AVAIL{"Property Available?<br/>(System Overlap Check)"}:::decision
        DATE_INPUT["Input: Select Check-in, Check-out<br/>& Number of Guests"]:::process
        VAL_DATES{"Dates Valid &<br/>Guests ≤ Capacity?"}:::decision
        NOTIFY_VAL["Notify Customer:<br/>Adjust Dates or Guests"]:::process
        SUBMIT_BOOK["Submit Booking Request"]:::process
        SET_PENDING["Set Booking = PENDING<br/>Apply 24h TTL Hold on Dates (G4)<br/>Save to Central DB & Notify Admin"]:::processEmph
        UPLOAD_KYC["Customer Uploads Valid Government ID<br/>Set KYC = SUBMITTED"]:::process
        ADMIN_REVIEW["Admin / Super Admin Review<br/>Booking Details & KYC"]:::process
        SYS_RECHECK{"System Auto Re-check:<br/>Dates Still Free? (G2)"}:::decision
        SUGGEST_ALT["Suggest Alternative Dates<br/>Notify Customer"]:::process
        REBOOK_DEC{"Customer Accepts<br/>Alternative Dates?"}:::decision
        REJECT_BOOK1["Set Booking = REJECTED<br/>Release Held Dates<br/>Notify Customer & Log (G1)"]:::process
        END_REJECT1([END: Overlap Rejection]):::terminalErr

        ID_VALID{"Government ID<br/>(KYC) Valid?"}:::decision
        NOTIFY_KYC["Notify Customer: Re-upload ID<br/>(Within 24h TTL)"]:::process
        RESUBMIT_KYC{"Customer Resubmits<br/>within TTL?"}:::decision
        REJECT_BOOK2["Set Booking = REJECTED<br/>Release Dates & Notify"]:::process
        END_REJECT2([END: KYC Rejection]):::terminalErr

        SET_APPROVED["Set Booking = APPROVED<br/>(Dates Firmly Held — G3 Money Last)<br/>Notify: Proceed to Payment"]:::processEmph
        PAY_SELECT["Customer Selects Payment Option:<br/>[50% Down Payment + Deposit] OR<br/>[Full Payment + Deposit]"]:::process
        UPLOAD_PAY["Customer Uploads Payment Proof<br/>Set Payment = PENDING"]:::process
        VERIFY_PAY["Admin / Super Admin Verifies Payment Proof<br/>Against Official Bank Records"]:::process
        PAY_VALID{"Payment Proof<br/>Valid & Verified?"}:::decision
        REJECT_PAY["Reject Payment & Notify Customer<br/>(Within TTL Window)"]:::process
        RESUBMIT_PAY{"Customer Resubmits<br/>Proof within TTL?"}:::decision
        CANCEL_PAY["Set Booking = CANCELLED<br/>Release Dates & Notify Customer<br/>(No Refund Needed)"]:::process
        END_CANCEL1([END: Unpaid Cancelled]):::terminalErr

        PAY_VERIFIED["Set Payment = VERIFIED<br/>Set Booking = RESERVED<br/>Save to DB & Notify Booker"]:::processEmph
        CREATE_TRACK["Create Booking Tracking Record<br/>Generate Tracking ID & QR Voucher"]:::process
        ASSIGN_CRED["Provision & Assign Credentials:<br/>RFID Card/Tag + In-App Mobile Key (BLE)"]:::processEmph

        TTL_TIMER["24h TTL Timer Expires<br/>(Any Pending Booking Inactive for 24h — G4)"]:::process
        EXPIRE_BKG["Set Booking = EXPIRED<br/>Release Held Dates<br/>Notify Customer & Admin (G1)"]:::process
        END_EXPIRED([END: Auto-Expired]):::terminalErr

        CUST_CANCEL["Customer Requests Cancellation<br/>(From Dashboard)"]:::process
        CANCEL_STATUS{"Booking Stage<br/>at Cancel Request?"}:::decision
        CANCEL_PRE_PAY["Pre-Payment (Pending/Approved):<br/>Set CANCELLED → Release Dates"]:::process
        END_CANCEL2([END: Pre-Payment Cancel]):::terminalErr
        ADMIN_REFUND_REV["Post-Payment (RESERVED):<br/>Admin Reviews per Cancellation Policy"]:::process
        REFUND_DEC{"Refund Approved<br/>per Policy?"}:::decision
        REFUND_EXEC["Set Booking = CANCELLED<br/>Release Held Dates<br/>Initiate & Execute Refund (Policy + Deposit)<br/>Set Status = REFUNDED & Notify"]:::processEmph
        END_REFUND([END: Refund Processed]):::terminal
        REFUND_DENY["Refund Denied per Policy Rules<br/>Booking Remains RESERVED"]:::process
        END_DENY_CANCEL([END: Booking Retained]):::terminal

        CUST_DASH --> PROP_AVAIL
        PROP_AVAIL -- No --> CUST_DASH
        PROP_AVAIL -- Yes --> DATE_INPUT
        DATE_INPUT --> VAL_DATES
        VAL_DATES -- No --> NOTIFY_VAL --> DATE_INPUT
        VAL_DATES -- Yes --> SUBMIT_BOOK
        SUBMIT_BOOK --> SET_PENDING
        SET_PENDING --> UPLOAD_KYC
        UPLOAD_KYC --> ADMIN_REVIEW
        ADMIN_REVIEW --> SYS_RECHECK
        SYS_RECHECK -- No --> SUGGEST_ALT --> REBOOK_DEC
        REBOOK_DEC -- Yes --> DATE_INPUT
        REBOOK_DEC -- No --> REJECT_BOOK1 --> END_REJECT1
        SYS_RECHECK -- Yes --> ID_VALID
        ID_VALID -- No --> NOTIFY_KYC --> RESUBMIT_KYC
        RESUBMIT_KYC -- Yes --> UPLOAD_KYC
        RESUBMIT_KYC -- No --> REJECT_BOOK2 --> END_REJECT2
        ID_VALID -- Yes --> SET_APPROVED
        SET_APPROVED --> PAY_SELECT
        PAY_SELECT --> UPLOAD_PAY
        UPLOAD_PAY --> VERIFY_PAY
        VERIFY_PAY --> PAY_VALID
        PAY_VALID -- No --> REJECT_PAY --> RESUBMIT_PAY
        RESUBMIT_PAY -- Yes --> UPLOAD_PAY
        RESUBMIT_PAY -- No --> CANCEL_PAY --> END_CANCEL1
        PAY_VALID -- Yes --> PAY_VERIFIED
        PAY_VERIFIED --> CREATE_TRACK
        CREATE_TRACK --> ASSIGN_CRED

        SET_PENDING -. 24h Timer .-> TTL_TIMER --> EXPIRE_BKG --> END_EXPIRED
        CUST_CANCEL --> CANCEL_STATUS
        CANCEL_STATUS -- Pending/Approved --> CANCEL_PRE_PAY --> END_CANCEL2
        CANCEL_STATUS -- Reserved --> ADMIN_REFUND_REV --> REFUND_DEC
        REFUND_DEC -- Yes --> REFUND_EXEC --> END_REFUND
        REFUND_DEC -- No --> REFUND_DENY --> END_DENY_CANCEL
    end

    %% ==========================================
    %% 3. RFID / MOBILE KEY SMART LOCK + ESP32
    %% ==========================================
    subgraph S3 ["3. RFID SMART LOCK + ESP32 MODULE FLOW (Dual Credential & Offline Mode)"]
        CHECKIN_TRIGGER([CHECK-IN TIME REACHED: 2:00 PM<br/>Guest Arrives at Villa]):::terminal
        PRESENT_CRED["Customer Presents RFID Card/Tag<br/>OR Taps Mobile Key in App via BLE (G5)"]:::process
        ESP32_SCAN["RFID Reader Scans UID /<br/>ESP32 Receives Signed Token"]:::process
        SEND_CRED["Send Credential to Verification Engine<br/>Log Event to Central DB<br/>(Offline Mode: Cached Token Fallback)"]:::process
        VERIFY_CRED{"Verify Credential:<br/>Customer + Booking + Property +<br/>Payment + Account + Dates + Status?"}:::decision
        SAVE_FAIL_LOG["Save Failed Access Log<br/>(Central DB / Offline Buffer)"]:::process
        FAIL_COUNT{"≥ 3 Failures within<br/>10 Minutes?"}:::decision
        ALERT_LOCKOUT["Alert Admin via Push/SMS<br/>Trigger 15-Minute Lockout"]:::process
        DENY_ACCESS["Deny Access (Beep & Red LED)"]:::process
        END_ACCESS([END ACCESS]):::terminalErr

        ESP32_UNLOCK["ESP32 Unlocks Solenoid/Deadbolt<br/>Audible Chime & Green LED Pulse"]:::processEmph
        SAVE_SUCCESS_LOG["Save Successful Access Log<br/>(Central DB Access History)"]:::process
        FIRST_UNLOCK{"First Successful Unlock<br/>on Check-in Day?"}:::decision
        SET_CHECKEDIN["Set Booking = CHECKED-IN<br/>Notify Admin: Guest Arrived"]:::processEmph
        SET_STAYING["Set Booking = STAYING<br/>Activate Authorized In-Stay State"]:::processEmph
        STAY_BEGINS["Customer Stay Begins<br/>Proceed to Location Tracking"]:::process

        CHECKIN_TRIGGER --> PRESENT_CRED
        PRESENT_CRED --> ESP32_SCAN
        ESP32_SCAN --> SEND_CRED
        SEND_CRED --> VERIFY_CRED
        VERIFY_CRED -- No --> SAVE_FAIL_LOG --> FAIL_COUNT
        FAIL_COUNT -- Yes --> ALERT_LOCKOUT --> END_ACCESS
        FAIL_COUNT -- No --> DENY_ACCESS --> END_ACCESS
        VERIFY_CRED -- Yes --> ESP32_UNLOCK
        ESP32_UNLOCK --> SAVE_SUCCESS_LOG
        SAVE_SUCCESS_LOG --> FIRST_UNLOCK
        FIRST_UNLOCK -- Yes --> SET_CHECKEDIN --> SET_STAYING
        FIRST_UNLOCK -- No --> SET_STAYING
        SET_STAYING --> STAY_BEGINS
    end

    %% ==========================================
    %% 4. GUEST LOCATION TRACKING MODULE (Consent-Gated)
    %% ==========================================
    subgraph S4 ["4. GUEST LOCATION TRACKING MODULE FLOW (Consent-Gated & RA 10173)"]
        TRACK_CONSENT{"Guest Consented to<br/>Location Tracking?<br/>(RA 10173 Data Privacy)"}:::decision
        TRACK_DISABLED["Tracking = DISABLED<br/>(Smart Lock & Access Logs only)"]:::process
        TRACK_ENABLED["Tracking = ENABLED<br/>(Active during stay only)"]:::processEmph
        GET_LOC["App Fetches Booker Location<br/>(Background GPS / Geofence)"]:::process
        RECORD_LOC["Record Telemetry:<br/>GPS, Accuracy, Timestamp, Municipality"]:::process
        SAVE_LOC_DB["Save Location to Central DB<br/>(Encrypted at Rest)"]:::process
        VIEW_LOC["Admin / Super Admin View Authorized Radar<br/>(Role-Restricted & Audited)"]:::process
        STILL_STAYING{"Guest Still Staying?<br/>(Check-out Not Passed)"}:::decision
        STOP_TRACK["Stop Location Tracking<br/>Record Final Location"]:::process
        WAIT_CHECKOUT["Proceed to Check-Out Flow"]:::process
        PURGE_RULE["Retention & Purge Engine:<br/>Auto-Purge Location N Days Post Check-Out<br/>Write Purge Audit Log (G6)"]:::processEmph

        TRACK_CONSENT -- No --> TRACK_DISABLED --> WAIT_CHECKOUT
        TRACK_CONSENT -- Yes --> TRACK_ENABLED --> GET_LOC
        GET_LOC --> RECORD_LOC --> SAVE_LOC_DB --> VIEW_LOC --> STILL_STAYING
        STILL_STAYING -- Yes --> GET_LOC
        STILL_STAYING -- No --> STOP_TRACK --> WAIT_CHECKOUT
        WAIT_CHECKOUT --> PURGE_RULE
    end

    %% ==========================================
    %% 5. CHECK-OUT, DAMAGE, SECURITY DEPOSIT & CLEANING
    %% ==========================================
    subgraph S5 ["5. CHECK-OUT, DAMAGE, CLEANING & INSPECTION FLOW"]
        CHECKOUT([CHECK-OUT TIME REACHED: 12:00 NN<br/>Guest Departs Property]):::terminal
        ESP32_LOCK["ESP32 Engages Lock<br/>Set Credential = INACTIVE"]:::process
        SAVE_CHECKOUT_LOG["Save Check-out Access Log<br/>Set Booking = CHECKED-OUT<br/>Notify Customer"]:::processEmph
        CREATE_CLEAN_TASK["Create Cleaning Task<br/>Auto-Assign Staff / Caretaker"]:::process
        DAMAGE_CHECK{"Damage Reported?<br/>(Staff Inspection or Self-Report)"}:::decision
        SUBMIT_DAMAGE["Submit Damage Report & Evidence<br/>(Photos/Videos + Description)"]:::process
        ADMIN_VERIFY_DMG["Admin / Super Admin Review Damage"]:::process
        DMG_VERIFIED{"Damage Verified<br/>& Chargeable?"}:::decision
        CLOSE_DAMAGE["Close Damage Report<br/>(Normal Wear & Tear)"]:::process
        SET_DMG_VERIFIED["Set Damage = VERIFIED<br/>Create Maintenance Work Order"]:::process
        SETTLE_DEPOSIT["Security Deposit Settlement:<br/>Deduct Repair Cost from Deposit<br/>Refund Remaining Deposit"]:::processEmph
        REPAIR_ITEM["Repair or Replace Damaged Item<br/>Update Maintenance Status"]:::process
        STAFF_CLEAN["Staff or Caretaker Cleans Accommodation<br/>Sanitization & Linen Change"]:::process
        CLEAN_DONE{"Cleaning<br/>Complete?"}:::decision
        PROP_INSPECT["Conduct Property Inspection<br/>By Head Staff / Admin"]:::process
        INSPECT_READY{"Clean and Ready<br/>for Next Guest?"}:::decision
        MAINT_REPAIR["Maintenance Rectification & Re-clean"]:::process
        SET_AVAILABLE["Set Property = AVAILABLE<br/>(Dates Rejoin Booking Pool — G1)"]:::processEmph
        SAVE_RECORDS["Save Cleaning, Maintenance, Damage &<br/>Inspection Records to Central DB"]:::process
        SET_COMPLETED["Set Booking = COMPLETED<br/>Notify Customer: Thank You + Deposit Statement"]:::processEmph
        GEN_REPORTS["Generate Operational & Turnover Reports"]:::process
        END_FLOW([END: Lifecycle Complete]):::terminal

        CHECKOUT --> ESP32_LOCK --> SAVE_CHECKOUT_LOG --> CREATE_CLEAN_TASK --> DAMAGE_CHECK
        DAMAGE_CHECK -- Yes --> SUBMIT_DAMAGE --> ADMIN_VERIFY_DMG --> DMG_VERIFIED
        DAMAGE_CHECK -- No --> STAFF_CLEAN
        DMG_VERIFIED -- No --> CLOSE_DAMAGE --> STAFF_CLEAN
        DMG_VERIFIED -- Yes --> SET_DMG_VERIFIED --> SETTLE_DEPOSIT --> REPAIR_ITEM --> STAFF_CLEAN
        STAFF_CLEAN --> CLEAN_DONE
        CLEAN_DONE -- No --> STAFF_CLEAN
        CLEAN_DONE -- Yes --> PROP_INSPECT --> INSPECT_READY
        INSPECT_READY -- No --> MAINT_REPAIR --> PROP_INSPECT
        INSPECT_READY -- Yes --> SET_AVAILABLE --> SAVE_RECORDS --> SET_COMPLETED --> GEN_REPORTS --> END_FLOW
    end

    %% ==========================================
    %% 6. STAFF MODULE FLOW
    %% ==========================================
    subgraph S6 ["6. STAFF MODULE FLOW"]
        STAFF_DASH["Staff Dashboard Access"]:::process
        STAFF_ACTIVE{"Staff Account<br/>ACTIVE?"}:::decision
        STAFF_DENY["Login Denied (Contact Administrator)"]:::process
        END_STAFF1([END: Staff Denied]):::terminalErr
        STAFF_OPS["Staff Operational Functions:<br/>• View Assigned Bookings<br/>• Manage Cleaning Tasks<br/>• Manage Maintenance Repairs<br/>• Property Inspections & Sign-offs"]:::process
        STAFF_LOG["Save Staff Activity Log to DB"]:::process
        END_STAFF2([END: Staff Session]):::terminal

        STAFF_DASH --> STAFF_ACTIVE
        STAFF_ACTIVE -- No --> STAFF_DENY --> END_STAFF1
        STAFF_ACTIVE -- Yes --> STAFF_OPS --> STAFF_LOG --> END_STAFF2
    end

    %% ==========================================
    %% 7. ADMIN MODULE FLOW
    %% ==========================================
    subgraph S7 ["7. ADMIN MODULE FLOW"]
        ADMIN_DASH["Admin Dashboard Access"]:::process
        ADMIN_ACTIVE{"Admin Account<br/>ACTIVE?"}:::decision
        ADMIN_DENY["Login Denied (Contact Super Admin)"]:::process
        END_ADMIN1([END: Admin Denied]):::terminalErr
        ADMIN_OPS["Admin Full Management Operations:<br/>• Manage Users, Staff, Accommodations & Bookings<br/>• Verify Customer Government ID (KYC) & Payments<br/>• Approve / Reject Bookings (System overlap check - G2)<br/>• Process Refunds & Security Deposit Deductions<br/>• Provision, Activate & Deactivate RFID/Mobile Keys<br/>• View Credential Logs, Radar & Authorized Locations<br/>• Audit Trails & Soft Archive Users/Staff"]:::process
        ADMIN_LOG["Save Admin Activity to Central DB Log"]:::process
        END_ADMIN2([END: Admin Session]):::terminal

        ADMIN_DASH --> ADMIN_ACTIVE
        ADMIN_ACTIVE -- No --> ADMIN_DENY --> END_ADMIN1
        ADMIN_ACTIVE -- Yes --> ADMIN_OPS --> ADMIN_LOG --> END_ADMIN2
    end

    %% ==========================================
    %% 8. SUPER ADMIN MODULE FLOW
    %% ==========================================
    subgraph S8 ["8. SUPER ADMIN MODULE FLOW"]
        SADASH([Super Admin Dashboard<br/>Status: ALWAYS ACTIVE]):::terminal
        SA_OPS["Super Admin Exclusive Powers:<br/>• All Full Admin Permissions<br/>• Account Provisioning: Create Admin & Staff Accounts<br/>• Manage Admin Accounts (Disable, Enable, Archive, Restore)<br/>• System-wide Audit Logs, Financial & ESP32 Telemetry"]:::process
        SA_SELF_CHECK{"Self-Action Check:<br/>Delete, Archive, or<br/>Disable Self?"}:::decision
        SA_SELF_DENIED["Action Denied & Blocked<br/>(Super Admin Self-Protection)"]:::process
        SA_EXEC["Execute Authorized Administrative Action"]:::process
        SAREPORT["Generate System Reports"]:::processEmph
        SA_LOG["Save Action to System-wide Audit Log"]:::process
        END_SA([END: Super Admin Session]):::terminal

        SADASH --> SA_OPS --> SA_SELF_CHECK
        SA_SELF_CHECK -- Yes --> SA_SELF_DENIED --> SADASH
        SA_SELF_CHECK -- No --> SA_EXEC --> SAREPORT --> SA_LOG --> END_SA
    end

    %% ==========================================
    %% 9. ACCOUNT MANAGEMENT & SOFT ARCHIVE
    %% ==========================================
    subgraph S9 ["9. ACCOUNT MANAGEMENT & SOFT ARCHIVE FLOW"]
        PROV_FLOW["Provisioning Workflow:<br/>• Customer Self-Registers (Customer Role Only)<br/>• Admin Creates Staff Accounts<br/>• Super Admin Creates Admin Accounts"]:::process
        ACC_DEL_REQ["User / Staff / Admin Requests Deletion<br/>OR Admin Initiates Archive"]:::process
        ACC_REVIEW["Admin / Super Admin Review Request"]:::process
        CHECK_ACTIVE_BKG{"Account Has<br/>Active Bookings? (G1)"}:::decision
        RESOLVE_BKG["Resolve, Transfer or Cancel Bookings First"]:::process
        ARCHIVE_ACC["Soft Archive Account:<br/>Set Status = ARCHIVED<br/>Revoke Login & Move to Archive DB"]:::processEmph
        RESTORE_ACC{"Restore Account<br/>Selected by Admin?"}:::decision
        KEEP_ARCHIVED["Account Remains in Archive DB"]:::process
        END_ARCHIVE1([END: Remains Archived]):::terminalErr
        EXEC_RESTORE["Set Status = ACTIVE<br/>Restore Login Permissions<br/>Write Restore Audit Log"]:::processEmph
        END_ARCHIVE2([END: Account Restored]):::terminal

        PROV_FLOW --> ACC_DEL_REQ --> ACC_REVIEW --> CHECK_ACTIVE_BKG
        CHECK_ACTIVE_BKG -- Yes --> RESOLVE_BKG --> ARCHIVE_ACC
        CHECK_ACTIVE_BKG -- No --> ARCHIVE_ACC
        ARCHIVE_ACC --> RESTORE_ACC
        RESTORE_ACC -- No --> KEEP_ARCHIVED --> END_ARCHIVE1
        RESTORE_ACC -- Yes --> EXEC_RESTORE --> END_ARCHIVE2
    end

    %% ==========================================
    %% 10. CENTRAL DATABASE & STORAGE
    %% ==========================================
    subgraph S10 ["10. CENTRAL DATABASE & STORAGE ENTITIES"]
        CENTRAL_DB[("CENTRAL DATABASE & STORAGE<br/>Users, KYC Docs, Accommodations, Bookings, TTL Holds,<br/>Payments, Proofs, Refunds, Deposits, RFID UIDs, BLE Keys,<br/>ESP32 Telemetry, GPS History, Damage, Maintenance, Audit Logs")]:::storage
    end

    %% ==========================================
    %% CROSS-MODULE SEAMLESS TRANSITIONS
    %% ==========================================
    ROLE -- Customer --> CUST_DASH
    ROLE -- Staff --> STAFF_DASH
    ROLE -- Admin --> ADMIN_DASH
    ROLE -- Super Admin --> SADASH

    ASSIGN_CRED --> CHECKIN_TRIGGER
    STAY_BEGINS --> TRACK_CONSENT
    PURGE_RULE --> CHECKOUT
    SET_AVAILABLE -. Sync Availability .-> CENTRAL_DB
    SET_PENDING -. 24h Date Hold .-> CENTRAL_DB
"""
    return m

if __name__ == '__main__':
    xml_content, nodes, edges = build_drawio_xml()
    mermaid_content = build_mermaid()
    
    with open('docs/HDL_SYSTEM_ARCHITECTURE.drawio', 'w') as f:
        f.write(xml_content)
    with open('docs/HDL_SYSTEM_ARCHITECTURE.xml', 'w') as f:
        f.write(xml_content)
    with open('docs/HDL_SYSTEM_ARCHITECTURE.mermaid', 'w') as f:
        f.write(mermaid_content)
        
    print(f"Generated Draw.io XML ({len(nodes)} nodes, {len(edges)} edges, {len(xml_content)} bytes)")
    print(f"Generated Mermaid flowchart ({len(mermaid_content)} bytes)")
