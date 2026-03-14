import { useState, useCallback, useRef, useEffect } from "react";

const C = {
  bg: "#060a14", surface: "#0f1629", surfaceLight: "#161f35",
  border: "#243050", borderActive: "#4f8fff",
  accent: "#4f8fff", accentDim: "#2a5fb8", accentGlow: "rgba(79,143,255,0.12)",
  green: "#34d399", greenDim: "#166534",
  orange: "#f59e0b", orangeDim: "#78350f",
  purple: "#a78bfa", purpleDim: "#5b21b6",
  rose: "#fb7185", roseDim: "#9f1239",
  cyan: "#22d3ee", cyanDim: "#155e75",
  text: "#e2e8f0", textDim: "#94a3b8", textMuted: "#64748b",
};

const componentInfo = {
  ap: {
    title: "Application Process (AP)",
    description: "A program instantiated in a processing system to accomplish some purpose. Contains one or more tasks (Application Entities) plus infrastructure for managing its resources: processing, storage, and IPC. APs communicate by requesting IPC services from a DIF via the IPC API.",
    details: [
      { label: "Key Principle", text: "APs only know the destination AP name and their local port-id. They never see DIF-internal addresses or connection-endpoint-ids.", color: C.green },
      { label: "API Interactions", text: "Allocate_Request \u2192 Send/Receive \u2192 Deallocate. The AP specifies QoS parameters and gets a port-id handle back. The port-id is the only identifier shared between the AP and the DIF.", color: C.accent },
      { label: "Naming", text: "APs are identified by Application-Process-Name (globally unambiguous) and optionally an instance-id and Application-Entity identifiers. Never by addresses.", color: C.purple },
    ]
  },
  ipc_api: {
    title: "IPC API (Service Boundary)",
    description: "The interface between Application Processes and the DIF. Provides primitives for requesting, using, and releasing IPC resources. This is the layer boundary.",
    details: [
      { label: "Allocate_Request", text: "Creates a flow. Parameters: destination AP name, source AP name, symmetric/asymmetric, QoS parameters, access control. Returns a port-id.", color: C.green },
      { label: "Send / Receive", text: "Transfer SDUs on an allocated flow using the port-id as a handle. SDU = contiguous unit of data whose integrity the DIF maintains.", color: C.accent },
      { label: "Modify", text: "Change the QoS on an existing (N)-flow without losing data. For asymmetric flows, can modify each direction independently.", color: C.orange },
      { label: "Deallocate", text: "Releases all resources, destroys all shared state, notifies communicating APs.", color: C.rose },
    ]
  },
  flow_allocator: {
    title: "Flow Allocator (FA)",
    description: "Handles allocation requests from APs. A Flow Allocator Instance (FAI) is created per request. Decouples port allocation from EFCP synchronization \u2014 eliminating well-known ports. Uses NSM for name resolution and CDAP for Create Flow exchanges.",
    details: [
      { label: "Step 1: NSM Resolution", text: "Uses the Namespace Management component and Directory Forwarding Table to find the (N)-address of the IPC Process with access to the destination AP.", color: C.accent },
      { label: "Step 2: Access Control", text: "Determines whether the requesting AP has permission to communicate with the destination AP.", color: C.rose },
      { label: "Step 3: EFCP Instantiation", text: "Creates the EFCP instance (DTP + optionally DTCP) BEFORE sending the CDAP Create Flow Request \u2014 avoids a race condition.", color: C.green },
      { label: "Step 4: Flow Binding", text: "Binds port-ids to EFCPM connection-endpoint-ids. The port-id (= FAI-id) is the only identifier shared between AP and DIF.", color: C.purple },
      { label: "Additional Capabilities", text: "Manages address changes, QoS modification, connection-id replacement (to prevent seq# reuse), and asymmetric flows.", color: C.orange },
    ]
  },
  delimiting: {
    title: "Delimiting",
    description: "The first operation performed by the DIF on data from the AP, usually by the API-primitives. Preserves the identity of each SDU so it can be delivered intact. One Delimiting function per (N)-flow. Specifically NOT part of EFCP.",
    details: [
      { label: "Independence from EFCP", text: "Delimiting is specifically designed NOT to be part of the EFCP Protocol. It creates user-data fields for PDUs before EFCP adds its PCI.", color: C.orange },
      { label: "Fragmentation", text: "If an SDU exceeds max PDU user-data size, it is split. Flags in the DTP header allow reassembly at destination.", color: C.accent },
      { label: "Concatenation", text: "Small SDUs may be combined into a single PDU user-data field. Delimiting markers ensure each can be separated.", color: C.green },
    ]
  },
  efcp: {
    title: "Error & Flow Control Protocol (EFCP)",
    description: "The single data transfer protocol in RINA, based on Watson's delta-t. An EFCPM consists of two state machines loosely coupled through a State Vector: DTP (tightly-bound) and DTCP (loosely-bound, optional). One EFCP instance per (N)-flow.",
    details: [
      { label: "DTP (Data Transfer Protocol)", text: "Tightly-bound mechanisms: sequencing, fragmentation/reassembly. PDU PCI contains only: src/dst addresses, QoS-cube-id, connection-endpoint-ids (the connection-identifier), and sequence number. One instance per flow.", color: C.accent },
      { label: "DTCP \u2014 OPTIONAL", text: "Loosely-bound feedback: retransmission and flow control. Only instantiated for flows needing reliability or flow control. Reads State Vector, generates Control PDUs.", color: C.green },
      { label: "DT State Vector", text: "Shared state: DTP writes, DTCP reads and writes. Contains seq numbers, window edges, retx queue, timers. Discarded after 2(MPL+A+R) of no traffic.", color: C.purple },
      { label: "Watson's Result (1981)", text: "Reliable transfer requires bounding: Maximum Packet Lifetime (MPL), Maximum Delay on Ack (A), Time to Complete Maximum Retries (R).", color: C.orange },
    ]
  },
  relaying: {
    title: "Relaying Task (RT)",
    description: "Performs relaying (forwarding) of PDUs within the DIF. An IPCP contains zero or one RT. Generally NOT found in hosts \u2014 primarily in routers. Inspects destination address and QoS-cube-id, consults Forwarding Table, sends PDUs to output.",
    details: [
      { label: "Zero or One per IPCP", text: "An IPCP contains zero or one RT. If present, there are no RTs in IPCPs of lower or higher rank in the same processing system.", color: C.accent },
      { label: "Three Forms", text: "1) Host RT (rare). 2) Interior Router RT \u2014 high-performance forwarding. 3) Border Router RT \u2014 also manages aggregation onto intermediate flows.", color: C.green },
      { label: "No Deep Packet Inspection", text: "EFCP PCI provides everything needed. SDUs are encrypted, so deep packet inspection is neither needed nor possible.", color: C.rose },
    ]
  },
  multiplexing: {
    title: "Multiplexing Task (MT)",
    description: "Moderates multiplexing of PDUs from different (N)-connections onto (N-1)-ports. Inherited from general DAP structure. Potentially one MT per (N-1)-port. Responsible for delivery of PDUs to the lower layer. Generates no additional PCI.",
    details: [
      { label: "Per (N-1)-Port", text: "Potentially one MT per (N-1)-port, mapping (N)-PDUs to the appropriate output. Responsible for delivery to the lower layer.", color: C.accent },
      { label: "Host vs Router", text: "Host MT: uses local resources, multiplexes onto local (N-1)-port-ids. Border Router: extra level of multiplexing, may aggregate PDUs.", color: C.green },
      { label: "No Additional PCI", text: "The MT generates no protocol control information. Scheduling and queue policies are set by the Resource Allocator.", color: C.orange },
    ]
  },
  sdu_protection: {
    title: "SDU Protection",
    description: "Protects SDUs being passed to the (N-1)-DIF. Applied after RT/MT determines the output port. Potentially different configuration per (N-1)-port, because different (N-1)-DIFs may have different media characteristics. Independent of EFCP.",
    details: [
      { label: "Functions", text: "Error detection/correction codes, confidentiality (encryption), integrity (cryptographic or not), Time-To-Live / Hop Count.", color: C.accent },
      { label: "Per (N-1)-Port", text: "One SDU Protection module per (N-1)-port. Protection may vary across ports reflecting limited media characteristics.", color: C.green },
      { label: "Layered Security", text: "When (N)-PDU is passed with confidentiality, (N-1)-IPCP cannot interpret (N)-PCI. Each DIF protects itself.", color: C.rose },
    ]
  },
  rib_daemon: {
    title: "RIB Daemon (Resource Information Base)",
    description: "Logical repository for all DIF state \u2014 a partially replicated distributed database. Stores routing tables, directory caches, performance data, load. Tasks subscribe to it. Uses CDAP to exchange state with peer RIB Daemons in other DIF members.",
    details: [
      { label: "Primary CDAP User", text: "The RIB Daemon is the primary user of CDAP within the DIF. Manages periodic and event-driven updates. Different strategies for different info types.", color: C.purple },
      { label: "Subscribers", text: "Flow Allocator, FTG, Resource Allocator, NSM, and Network Management all read from and contribute to the RIB.", color: C.green },
      { label: "Compartmentalization", text: "Subscriptions can use different keys and restrict info to subsets of members \u2014 the DIF's internal defense against compromised members.", color: C.rose },
    ]
  },
  ftg_ra: {
    title: "FTG (Routing) + Resource Allocator",
    description: "Two closely related infrastructure components. The Forwarding Table Generator (FTG, 'sometimes called routing') analyzes RIB connectivity to generate forwarding entries. The Resource Allocator monitors resources, manages QoS, builds the final Forwarding Table.",
    details: [
      { label: "FTG / Routing", text: "Uses RIB info to create forwarding table entries. Different metrics for different QoS classes. Choice of algorithm is a DIF policy.", color: C.accent },
      { label: "Resource Allocator", text: "Monitors resources, assigns flows to MTs, regulates per-flow resources, populates FIB, monitors RT/MT, manages (N-1)-DIF services. Sets scheduling policies.", color: C.green },
      { label: "Key Insight", text: "A DIF is a distributed resource allocator \u2014 more like an OS than telecom. Layers divide ranges of allocation and scope.", color: C.purple },
    ]
  },
  nsm: {
    title: "Namespace Management (NSM)",
    description: "Manages (N+1)-AP-name to (N)-address mappings. Used by Flow Allocator to resolve destination names. Maintains Directory Forwarding Table (search rules). Also used during enrollment for address assignment.",
    details: [
      { label: "Directory Function", text: "Maps application names to addresses at upper DIF boundary. Caching strategies vary radically across DIFs \u2014 small DIFs may use exhaustive search, large ones hierarchies.", color: C.accent },
      { label: "Search Rules", text: "Directory Forwarding Table maps Requested_App_Naming_Info to IPCP_App_Naming_Info. If returned IPCP is local, app is here; else continue search.", color: C.green },
      { label: "Address Assignment", text: "Accessed during enrollment to assign synonym (address) for new member. May delegate address blocks. Updates via CDAP through RIB Daemon.", color: C.orange },
    ]
  },
  enrollment: {
    title: "Enrollment & DAF Management",
    description: "To join a DIF, an IPCP must enroll with an existing member via a supporting (N-1)-DIF. DAF Management handles ongoing security, key management, NMS agent.",
    details: [
      { label: "Process", text: "Uses (N-1)-DIF for CDAP connection with current member. Newcomer is authenticated, assigned address (via NSM), initialized with DIF params: max PDU size, timeouts, policies, routing info.", color: C.accent },
      { label: "Authentication", text: "Robustness is DIF policy \u2014 from null/password to strong crypto. All members explicitly enrolled and authenticated.", color: C.rose },
      { label: "Three DIF Security Services", text: "1) Authentication (enrollment). 2) Confidentiality & Integrity (SDU Protection). 3) Access Control (Flow Allocator checks permissions).", color: C.orange },
    ]
  },
  n1_dif: {
    title: "(N-1)-DIF \u2014 Recursive Layer Below",
    description: "Has the EXACT same internal structure. The (N)-IPCP appears as just another AP to the (N-1)-DIF. Layers repeat as many times as necessary \u2014 not 5 or 7 fixed layers.",
    details: [
      { label: "Identical Structure", text: "Each DIF contains: FA, NSM, Delimiting, EFCP (DTP + optional DTCP), RT (optional), MT, SDU Protection, RIB, FTG, RA, Enrollment.", color: C.accent },
      { label: "Scope Varies", text: "Lower DIFs: smaller scope (single link/LAN). Higher DIFs: wider scope. Number of layers determined by network needs.", color: C.green },
      { label: "Minimal Trust", text: "A DIF needs very little trust in (N-1)-DIFs \u2014 only that they attempt to deliver SDUs. Each DIF does its own auth, confidentiality, integrity.", color: C.rose },
      { label: "Multihoming Is Free", text: "Addresses in one layer, points-of-attachment in layer below \u2014 multihoming is inherent to the structure.", color: C.purple },
    ]
  },
  connection: {
    title: "Flow & Connection (Decoupled)",
    description: "RINA decouples flows from connections. (N)-Flow = binding of a connection to source and destination ports. (N)-Connection = shared EFCP state between EFCPMs. FA allocates ports; sending data creates the connection.",
    details: [
      { label: "(N)-Flow", text: "Binding of port-ids + CEP-ids + connection (or potential for one). Port-ids are FAI-ids. Persist until Deallocate.", color: C.accent },
      { label: "(N)-Connection", text: "Shared EFCP state between EFCPMs. Created on first Send. Discarded after 2(MPL+A+R) silence \u2014 no effect on port-ids.", color: C.green },
      { label: "Security Benefits", text: "No well-known ports. No visible addresses to AP. FA can rotate connection-ids to prevent seq# reuse \u2014 no need for IPSec-style security connections.", color: C.rose },
    ]
  },
  cdap: {
    title: "CDAP (Common Application Protocol)",
    description: "The single application protocol in RINA. Three modules: CACE (connection establishment), Auth (authentication plug-in), modified CMIP for operations. AEs defined by object sets.",
    details: [
      { label: "6 Operations", text: "Create/Delete, Read/Write, Start/Stop on defined objects. Anything more complex uses programs/scripts sent as user-data.", color: C.accent },
      { label: "Auth Module", text: "Plug-in for authenticating correspondents. Many modules possible \u2014 from null to strong crypto. Each defines its own policy range.", color: C.rose },
      { label: "DIF Usage", text: "RIB Daemon: state sync. Flow Allocator: Create/Delete flow. Enrollment: initialize new members.", color: C.green },
      { label: "Two Protocols Total", text: "RINA needs only EFCP (data transfer) + CDAP (everything else). Application behavior is in the objects, not the protocol.", color: C.purple },
    ]
  },
};

const InfoPanel = ({ title, description, details, onClose }) => (
  <div style={{
    position: "fixed", top: 0, right: 0, bottom: 0, width: 370,
    background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`,
    borderLeft: `1px solid ${C.border}`, zIndex: 100,
    display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
  }}>
    <div style={{ padding: "18px 18px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: C.accent, margin: 0, fontFamily: "monospace", lineHeight: 1.3 }}>{title}</h2>
      <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 22, padding: "0 0 0 10px", lineHeight: 1 }}>{"\u00D7"}</button>
    </div>
    <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
      <p style={{ color: C.text, fontSize: 13, lineHeight: 1.65, margin: "0 0 16px" }}>{description}</p>
      {details && details.map((d, i) => (
        <div key={i} style={{ marginBottom: 12, padding: "9px 11px", background: C.surfaceLight, borderRadius: 7, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: d.color || C.accent, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "monospace" }}>{d.label}</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>{d.text}</div>
        </div>
      ))}
    </div>
  </div>
);

const Box = ({ x, y, w, h, label, sublabel, color, onClick, glow, dashed, fontSize, radius }) => (
  <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
    {glow && <rect x={x-2} y={y-2} width={w+4} height={h+4} rx={(radius||6)+2} fill="none" stroke={color} strokeWidth={1} opacity={0.25} />}
    <rect x={x} y={y} width={w} height={h} rx={radius||6} fill={C.surfaceLight}
      stroke={color||C.border} strokeWidth={dashed?1.2:1.5}
      strokeDasharray={dashed?"5,3":"none"} />
    {label && <text x={x+w/2} y={y+(sublabel?h/2-5:h/2+1)} textAnchor="middle" dominantBaseline="middle" fill={color||C.text} fontSize={fontSize||11} fontWeight={700} fontFamily="monospace" style={{pointerEvents:"none"}}>{label}</text>}
    {sublabel && <text x={x+w/2} y={y+h/2+8} textAnchor="middle" dominantBaseline="middle" fill={C.textMuted} fontSize={8} fontFamily="sans-serif" style={{pointerEvents:"none"}}>{sublabel}</text>}
  </g>
);

const Arr = ({ x1, y1, x2, y2, color, label, dashed, labelDx, labelDy }) => {
  const id = `a${Math.round(x1)}${Math.round(y1)}${Math.round(x2)}${Math.round(y2)}`.replace(/[.\-]/g,"");
  return (<g>
    <defs><marker id={id} viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth={7} markerHeight={5} orient="auto-start-reverse"><polygon points="0 0, 10 3.5, 0 7" fill={color||C.textMuted}/></marker></defs>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color||C.textMuted} strokeWidth={1.3} strokeDasharray={dashed?"4,3":"none"} markerEnd={`url(#${id})`}/>
    {label && <text x={(x1+x2)/2+(labelDx||6)} y={(y1+y2)/2+(labelDy||0)} fill={color||C.textMuted} fontSize={7.5} fontFamily="sans-serif" dominantBaseline="middle">{label}</text>}
  </g>);
};

const Legend = () => (
  <div style={{position:"absolute",top:10,right:10,background:C.surfaceLight,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:9,color:C.textDim,display:"flex",flexDirection:"column",gap:4,zIndex:10}}>
    {[[C.accent,"Data Transfer Path"],[C.green,"Flow / Connection Mgmt"],[C.orange,"Infrastructure / Mgmt"],[C.purple,"App Protocol (CDAP)"],[C.rose,"Security / Protection"],[C.cyan,"Application Processes"]].map(([c,l])=>(
      <div key={l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:c,opacity:0.7}}/><span>{l}</span></div>
    ))}
    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:4,marginTop:2,color:C.textMuted,fontSize:8}}>Click any component for details</div>
  </div>
);

export default function RINADiagram() {
  const [view, setView] = useState("overview");
  const [info, setInfo] = useState(null);
  const [pan, setPan] = useState({x:0,y:0});
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({x:0,y:0});
  const show = useCallback((key) => { if(componentInfo[key]) setInfo(componentInfo[key]); },[]);
  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom(z => Math.max(0.25,Math.min(4,z*(e.deltaY>0?0.92:1.08)))); },[]);
  const handleMouseDown = useCallback((e) => { if(e.button===0){isPanning.current=true;lastMouse.current={x:e.clientX,y:e.clientY};} },[]);
  const handleMouseMove = useCallback((e) => { if(isPanning.current){setPan(p=>({x:p.x+e.clientX-lastMouse.current.x,y:p.y+e.clientY-lastMouse.current.y}));lastMouse.current={x:e.clientX,y:e.clientY};} },[]);
  const handleMouseUp = useCallback(() => { isPanning.current=false; },[]);
  useEffect(() => { const svg=svgRef.current; if(svg) svg.addEventListener("wheel",handleWheel,{passive:false}); return ()=>{if(svg) svg.removeEventListener("wheel",handleWheel);}; },[handleWheel]);
  const resetView = () => { setPan({x:0,y:0}); setZoom(1); };

  const NavBtn = ({label,active,onClick:oc}) => (
    <button onClick={()=>{oc();resetView();}} style={{padding:"6px 12px",borderRadius:5,fontSize:10,fontWeight:600,fontFamily:"monospace",cursor:"pointer",transition:"all 0.2s",background:active?C.accent:"transparent",color:active?"#fff":C.textDim,border:`1px solid ${active?C.accent:C.border}`}}>{label}</button>
  );

  const renderOverview = () => {
    const lx=80,rx=570,iw=380,bx=15,bw=iw-30;
    return (<g>
      <text x={510} y={26} textAnchor="middle" fill={C.text} fontSize={15} fontWeight={700} fontFamily="monospace">RINA: Two Application Processes Communicating</text>
      <text x={510} y={42} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="sans-serif">Recursive InterNetwork Architecture {"\u2014"} John Day {"\u00B7"} Click any component for spec details</text>

      <rect x={35} y={56} width={440} height={510} rx={10} fill="none" stroke={C.border} strokeWidth={0.8} strokeDasharray="8,5"/>
      <text x={255} y={70} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="monospace">PROCESSING SYSTEM A</text>
      <rect x={545} y={56} width={440} height={510} rx={10} fill="none" stroke={C.border} strokeWidth={0.8} strokeDasharray="8,5"/>
      <text x={765} y={70} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="monospace">PROCESSING SYSTEM B</text>

      <Box x={100} y={82} w={310} h={44} label="Application Process A" sublabel="(Source AP)" color={C.cyan} glow onClick={()=>show("ap")}/>
      <Box x={600} y={82} w={310} h={44} label="Application Process B" sublabel="(Destination AP)" color={C.cyan} glow onClick={()=>show("ap")}/>
      <Box x={100} y={138} w={310} h={24} label={"IPC API  (Allocate \u00B7 Send \u00B7 Receive \u00B7 Deallocate)"} color={C.green} fontSize={8} onClick={()=>show("ipc_api")}/>
      <Box x={600} y={138} w={310} h={24} label={"IPC API  (Allocate \u00B7 Send \u00B7 Receive \u00B7 Deallocate)"} color={C.green} fontSize={8} onClick={()=>show("ipc_api")}/>

      <rect x={50} y={178} width={920} height={385} rx={10} fill="rgba(79,143,255,0.03)" stroke={C.accentDim} strokeWidth={2}/>
      <text x={510} y={194} textAnchor="middle" fill={C.accent} fontSize={11} fontWeight={700} fontFamily="monospace">(N)-DIF {"\u2014"} Distributed IPC Facility (Layer)</text>
      <text x={510} y={207} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily="sans-serif">A distributed application that manages IPC {"\u00B7"} Same structure repeats at every layer {"\u00B7"} A DIF is a distributed resource allocator</text>

      {[{ox:lx,side:"A"},{ox:rx,side:"B"}].map(({ox,side})=>(
        <g key={side}>
          <rect x={ox} y={220} width={iw} height={330} rx={8} fill="rgba(22,31,53,0.7)" stroke={C.border} strokeWidth={1.3}/>
          <text x={ox+iw/2} y={235} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={700} fontFamily="monospace">IPC Process {side} (IPCP)</text>

          <Box x={ox+bx} y={248} w={115} h={30} label="Flow Allocator" color={C.green} fontSize={8} onClick={()=>show("flow_allocator")}/>
          <Box x={ox+bx+125} y={248} w={80} h={30} label="NSM" sublabel="Name Mgmt" color={C.green} fontSize={8} onClick={()=>show("nsm")}/>
          <Box x={ox+bx+215} y={248} w={135} h={30} label="Delimiting" color={C.orange} fontSize={8} onClick={()=>show("delimiting")}/>

          <Box x={ox+bx} y={294} w={bw} h={50} label="EFCP" sublabel={"DTP  +  DTCP (optional)  +  State Vector"} color={C.accent} onClick={()=>show("efcp")}/>

          <Box x={ox+bx} y={360} w={bw} h={26} label="Relaying Task (RT)" sublabel="forwarding decision \u00B7 0 or 1 per IPCP" color={C.accent} fontSize={8} onClick={()=>show("relaying")}/>

          <Box x={ox+bx} y={400} w={bw} h={26} label="Multiplexing Task (MT)" sublabel={"maps to (N-1)-port \u00B7 1 per (N-1)-port"} color={C.accent} fontSize={8} onClick={()=>show("multiplexing")}/>

          <Box x={ox+bx} y={440} w={bw} h={26} label="SDU Protection" sublabel={"per (N-1)-port \u00B7 integrity \u00B7 encryption \u00B7 TTL"} color={C.rose} fontSize={8} onClick={()=>show("sdu_protection")}/>

          <line x1={ox+12} y1={480} x2={ox+iw-12} y2={480} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3"/>
          <text x={ox+iw/2} y={490} textAnchor="middle" fill={C.textMuted} fontSize={7} fontFamily="monospace">{"\u2500\u2500"} INFRASTRUCTURE (uses CDAP) {"\u2500\u2500"}</text>

          <Box x={ox+bx} y={500} w={85} h={30} label="RIB" sublabel="Daemon" color={C.purple} fontSize={8} onClick={()=>show("rib_daemon")}/>
          <Box x={ox+bx+95} y={500} w={85} h={30} label="FTG" sublabel="Routing" color={C.orange} fontSize={8} onClick={()=>show("ftg_ra")}/>
          <Box x={ox+bx+190} y={500} w={85} h={30} label="Res. Alloc." sublabel="QoS Mgmt" color={C.orange} fontSize={8} onClick={()=>show("ftg_ra")}/>
          <Box x={ox+bx+285} y={500} w={65} h={30} label="Enroll" color={C.orange} fontSize={8} onClick={()=>show("enrollment")}/>
        </g>
      ))}

      {/* Left arrows (outgoing, downward): EFCP → RT → MT → SDU Prot → (N-1)-DIF */}
      <Arr x1={lx+iw/2} y1={126} x2={lx+iw/2} y2={138} color={C.green}/>
      <Arr x1={lx+iw/2} y1={162} x2={lx+iw/2} y2={248} color={C.green} label="SDU" labelDx={8}/>
      <Arr x1={lx+iw/2} y1={278} x2={lx+iw/2} y2={294} color={C.accent}/>
      <Arr x1={lx+iw/2} y1={344} x2={lx+iw/2} y2={360} color={C.accent} label="PDU" labelDx={8}/>
      <Arr x1={lx+iw/2} y1={386} x2={lx+iw/2} y2={400} color={C.accent}/>
      <Arr x1={lx+iw/2} y1={426} x2={lx+iw/2} y2={440} color={C.accent}/>
      <Arr x1={lx+iw/2} y1={466} x2={lx+iw/2} y2={570} color={C.rose} label="Protected PDU" labelDx={8}/>
      <text x={lx-5} y={370} fill={C.textMuted} fontSize={7} fontFamily="monospace" textAnchor="end" transform={`rotate(-90,${lx-5},370)`}>OUTGOING {"\u2193"}</text>

      {/* Right arrows (incoming, upward): (N-1)-DIF → SDU Prot → MT → RT → EFCP */}
      <Arr x1={rx+iw/2} y1={138} x2={rx+iw/2} y2={126} color={C.green}/>
      <Arr x1={rx+iw/2} y1={248} x2={rx+iw/2} y2={162} color={C.green} label="SDU" labelDx={8}/>
      <Arr x1={rx+iw/2} y1={294} x2={rx+iw/2} y2={278} color={C.accent}/>
      <Arr x1={rx+iw/2} y1={360} x2={rx+iw/2} y2={344} color={C.accent} label="PDU" labelDx={8}/>
      <Arr x1={rx+iw/2} y1={400} x2={rx+iw/2} y2={386} color={C.accent}/>
      <Arr x1={rx+iw/2} y1={440} x2={rx+iw/2} y2={426} color={C.accent}/>
      <Arr x1={rx+iw/2} y1={570} x2={rx+iw/2} y2={466} color={C.rose} label="Protected PDU" labelDx={8}/>
      <text x={rx+iw+8} y={370} fill={C.textMuted} fontSize={7} fontFamily="monospace" transform={`rotate(90,${rx+iw+8},370)`}>{"\u2191"} INCOMING</text>

      {/* EFCP Connection */}
      <line x1={lx+iw} y1={319} x2={rx} y2={319} stroke={C.accent} strokeWidth={2} strokeDasharray="6,3"/>
      <rect x={468} y={307} width={84} height={24} rx={4} fill={C.bg} stroke={C.accent} strokeWidth={1}/>
      <text x={510} y={316} textAnchor="middle" fill={C.accent} fontSize={8} fontWeight={600} fontFamily="monospace">(N)-Connection</text>
      <text x={510} y={326} textAnchor="middle" fill={C.textMuted} fontSize={7} fontFamily="sans-serif" style={{cursor:"pointer"}} onClick={()=>show("connection")}>shared EFCP state</text>

      {/* CDAP line */}
      <line x1={lx+iw} y1={515} x2={rx} y2={515} stroke={C.purple} strokeWidth={1} strokeDasharray="4,3"/>
      <text x={510} y={510} textAnchor="middle" fill={C.purple} fontSize={7} fontFamily="monospace" style={{cursor:"pointer"}} onClick={()=>show("cdap")}>CDAP (RIB sync, enrollment, mgmt)</text>

      {/* (N-1)-DIF */}
      <rect x={50} y={570} width={920} height={55} rx={10} fill="rgba(52,211,153,0.03)" stroke={C.greenDim} strokeWidth={2}/>
      <text x={510} y={588} textAnchor="middle" fill={C.green} fontSize={11} fontWeight={700} fontFamily="monospace" style={{cursor:"pointer"}} onClick={()=>show("n1_dif")}>(N-1)-DIF {"\u2014"} Identical Structure, Recursively</text>
      <text x={510} y={602} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily="sans-serif">Contains its own: FA {"\u00B7"} NSM {"\u00B7"} Delimiting {"\u00B7"} EFCP {"\u00B7"} RT {"\u00B7"} MT {"\u00B7"} SDU Protection {"\u00B7"} RIB {"\u00B7"} FTG {"\u00B7"} RA {"\u00B7"} Enrollment</text>
      <text x={510} y={616} textAnchor="middle" fill={C.textMuted} fontSize={7.5} fontFamily="sans-serif">The (N)-IPCPs appear as ordinary Application Processes to the (N-1)-DIF</text>

      <rect x={50} y={635} width={920} height={22} rx={6} fill="rgba(167,139,250,0.03)" stroke={C.purpleDim} strokeWidth={0.8} strokeDasharray="5,4"/>
      <text x={510} y={649} textAnchor="middle" fill={C.purple} fontSize={8} fontFamily="monospace">(N-2)-DIF ... repeats down to physical media {"\u00B7"} Number of layers determined by network needs, not a fixed model</text>
    </g>);
  };

  const renderDataFlow = () => (<g>
    <text x={530} y={26} textAnchor="middle" fill={C.text} fontSize={14} fontWeight={700} fontFamily="monospace">Data Flow: Sending an SDU Through the DIF</text>
    <text x={530} y={42} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="sans-serif">Step-by-step path from source AP to destination AP</text>
    {[
      {n:"1",label:"AP calls Send(port-id, buffer)",sub:"SDU passed to DIF via IPC API",color:C.cyan,key:"ipc_api"},
      {n:"2",label:"Delimiting preserves SDU identity",sub:"Fragment or concatenate to fill PDU user-data fields. One per flow. NOT part of EFCP.",color:C.orange,key:"delimiting"},
      {n:"3",label:"DTP adds PCI \u2192 creates Transfer PDU",sub:"PCI = src-addr, dst-addr, QoS-cube-id, CEP-ids (connection-id), sequence number",color:C.accent,key:"efcp"},
      {n:"4",label:"DTCP manages flow/retransmission (IF REQUIRED)",sub:"OPTIONAL: only for flows needing reliability or flow control. Reads State Vector, generates Control PDUs.",color:C.accent,key:"efcp"},
      {n:"5",label:"Relaying Task forwards via Forwarding Table",sub:"Inspects dest-addr + QoS-cube-id \u2192 next hop. Zero or one RT per IPCP; generally not in hosts.",color:C.accent,key:"relaying"},
      {n:"6",label:"Multiplexing Task maps to (N-1)-port",sub:"Multiplexes PDUs from different (N)-connections onto appropriate (N-1)-port. One MT per (N-1)-port.",color:C.accent,key:"multiplexing"},
      {n:"7",label:"SDU Protection applied per (N-1)-port",sub:"Error detection, encryption, integrity, TTL \u2014 may differ per port based on media characteristics.",color:C.rose,key:"sdu_protection"},
      {n:"8",label:"Protected PDU delivered as SDU to (N-1)-DIF",sub:"(N-1)-DIF cannot interpret (N)-PCI if confidentiality is applied. Treats it as opaque data.",color:C.green,key:"n1_dif"},
      {n:"\u27F3",label:"Same process repeats recursively in (N-1)-DIF",sub:"Delimiting \u2192 DTP \u2192 DTCP \u2192 RT \u2192 MT \u2192 SDU Protection \u2192 (N-2)-DIF ... to physical media.",color:C.purple,key:"n1_dif"},
    ].map((step,i) => (<g key={i} onClick={()=>show(step.key)} style={{cursor:"pointer"}}>
      <rect x={80} y={60+i*56} width={900} height={44} rx={7} fill={C.surfaceLight} stroke={C.border} strokeWidth={1}/>
      <circle cx={108} cy={60+i*56+22} r={13} fill="none" stroke={step.color} strokeWidth={1.5}/>
      <text x={108} y={60+i*56+23} textAnchor="middle" dominantBaseline="middle" fill={step.color} fontSize={10} fontWeight={700} fontFamily="monospace">{step.n}</text>
      <text x={135} y={60+i*56+16} fill={C.text} fontSize={11} fontWeight={600} fontFamily="monospace">{step.label}</text>
      <text x={135} y={60+i*56+32} fill={C.textDim} fontSize={9} fontFamily="sans-serif">{step.sub}</text>
      {i<8 && <Arr x1={108} y1={60+i*56+44} x2={108} y2={60+(i+1)*56} color={step.color}/>}
    </g>))}
    <text x={530} y={580} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={700} fontFamily="monospace">At the Destination IPCP (reverse path):</text>
    {[
      {label:"(N-1)-DIF delivers SDU \u2192 SDU Protection verifies integrity, decrypts",color:C.rose},
      {label:"RT/MT inspects dest-addr \u2192 if local, delivers to EFCP instance; if not, relays",color:C.accent},
      {label:"DTP checks sequence numbers, reorders. DTCP sends ACKs (if active on this flow).",color:C.accent},
      {label:"Delimiting reassembles original SDU from fragments / separates concatenated SDUs",color:C.orange},
      {label:"SDU delivered to destination AP via Receive(port-id, buffer)",color:C.cyan},
    ].map((s,i) => (<g key={i}>
      <circle cx={108} cy={602+i*22} r={4} fill={s.color} opacity={0.6}/>
      <text x={125} y={603+i*22} fill={s.color} fontSize={9.5} fontFamily="sans-serif" dominantBaseline="middle">{s.label}</text>
    </g>))}
  </g>);

  const renderEFCPDetail = () => (<g>
    <text x={510} y={26} textAnchor="middle" fill={C.text} fontSize={14} fontWeight={700} fontFamily="monospace">EFCP Internal Structure {"\u2014"} Per-Flow Instance</text>
    <text x={510} y={42} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="sans-serif">Based on Watson{"'"}s delta-t {"\u00B7"} Tightly-bound (DTP) separated from loosely-bound (DTCP) mechanisms</text>
    {[{ox:30,lbl:"Source"},{ox:550,lbl:"Destination"}].map(({ox,lbl})=>(<g key={lbl}>
      <rect x={ox} y={60} width={440} height={580} rx={10} fill="rgba(22,31,53,0.5)" stroke={C.border} strokeWidth={1.3}/>
      <text x={ox+220} y={78} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={700} fontFamily="monospace">{lbl} EFCPM Instance</text>

      <rect x={ox+18} y={92} width={404} height={195} rx={8} fill="rgba(79,143,255,0.05)" stroke={C.accentDim} strokeWidth={1.3}/>
      <text x={ox+220} y={108} textAnchor="middle" fill={C.accent} fontSize={11} fontWeight={700} fontFamily="monospace">DTP {"\u2014"} Data Transfer Protocol</text>
      <text x={ox+220} y={122} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily="sans-serif">Tightly-bound mechanisms {"\u00B7"} One per flow allocated</text>
      {(lbl==="Source"?[
        {l:"Assign Sequence Number",d:"Monotonically increasing, per-flow",y:140},
        {l:"Build Transfer PDU PCI",d:"src-addr, dst-addr, QoS-cube-id, CEP-ids, seq#",y:166},
        {l:"Fragment if needed",d:"If SDU exceeds max PDU user-data size",y:192},
        {l:"Copy to retransmission queue",d:"If DTCP retransmission is active on this flow",y:218},
        {l:"Post to RT/MT output queue",d:"Queue name stored in State Vector by RA",y:244},
      ]:[
        {l:"Match Connection-ID",d:"Identify local EFCPM instance via CEP-ids",y:140},
        {l:"Check Sequence Number",d:"Detect gaps, duplicates; reorder if policy requires",y:166},
        {l:"Reassemble Fragments",d:"Reconstruct original SDU if fragmented",y:192},
        {l:"Update State Vector",d:"Write seq_num_rcvd, queue status, trigger DTCP",y:218},
        {l:"Deliver SDU via port-id",d:"Pass through Delimiting up to AP",y:244},
      ]).map((item,i)=>(<g key={i}>
        <circle cx={ox+38} cy={item.y+4} r={3.5} fill={C.accent} opacity={0.6}/>
        <text x={ox+52} y={item.y+1} fill={C.text} fontSize={9.5} fontWeight={600} fontFamily="monospace">{item.l}</text>
        <text x={ox+52} y={item.y+13} fill={C.textMuted} fontSize={8} fontFamily="sans-serif">{item.d}</text>
      </g>))}

      <rect x={ox+80} y={300} width={280} height={78} rx={7} fill="rgba(167,139,250,0.07)" stroke={C.purple} strokeWidth={1.3}/>
      <text x={ox+220} y={316} textAnchor="middle" fill={C.purple} fontSize={10} fontWeight={700} fontFamily="monospace">DT State Vector</text>
      {["seq_num_sent, seq_num_rcvd","left_window_edge, right_window_edge","retx_queue, rmt_queue_name","timers: MPL, A (max ack delay), R (max retries)"].map((t,i)=>
        <text key={i} x={ox+220} y={332+i*13} textAnchor="middle" fill={C.textDim} fontSize={7.5} fontFamily="monospace">{t}</text>
      )}
      <Arr x1={ox+220} y1={287} x2={ox+220} y2={300} color={C.accent} label={`DTP writes ${"\u2193"}`} labelDx={-42}/>

      <rect x={ox+18} y={395} width={404} height={230} rx={8} fill="rgba(52,211,153,0.04)" stroke={C.greenDim} strokeWidth={1.3}/>
      <text x={ox+220} y={411} textAnchor="middle" fill={C.green} fontSize={11} fontWeight={700} fontFamily="monospace">DTCP {"\u2014"} Data Transfer Control</text>
      <text x={ox+220} y={425} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily="sans-serif">OPTIONAL {"\u00B7"} Loosely-bound feedback {"\u00B7"} Only if flow needs reliability/flow control</text>
      {(lbl==="Source"?[
        {l:"Flow Control",d:"Window-based: adjusts sender rate via credits",y:443},
        {l:"Retransmission Control",d:"Detects gaps, triggers retransmit from queue",y:469},
        {l:"ACK Generation",d:"Sends ACK/NACK Control PDUs to peer DTCP",y:495},
        {l:"Transmission Control",d:"Rate-based or window-based pacing policies",y:521},
        {l:"Inactivity Timer",d:"Discard connection state after 2(MPL+A+R) silence",y:547},
        {l:"State after silence",d:"Connection gone but flow (port-ids) persists until Deallocate",y:573},
      ]:[
        {l:"Process incoming ACKs",d:"Update window, release retransmission queue entries",y:443},
        {l:"Generate ACKs / NACKs",d:"Inform sender of received sequence numbers",y:469},
        {l:"Flow Control Credits",d:"Advertise receive window to sender DTCP",y:495},
        {l:"Gap Detection",d:"Request retransmission of missing PDUs via NACK",y:521},
        {l:"Inactivity Timer",d:"Discard connection state after 2(MPL+A+R) silence",y:547},
        {l:"State after silence",d:"Connection gone but flow (port-ids) persists until Deallocate",y:573},
      ]).map((item,i)=>(<g key={i}>
        <circle cx={ox+38} cy={item.y+4} r={3.5} fill={C.green} opacity={0.6}/>
        <text x={ox+52} y={item.y+1} fill={C.text} fontSize={9.5} fontWeight={600} fontFamily="monospace">{item.l}</text>
        <text x={ox+52} y={item.y+13} fill={C.textMuted} fontSize={8} fontFamily="sans-serif">{item.d}</text>
      </g>))}
      <Arr x1={ox+220} y1={378} x2={ox+220} y2={395} color={C.green} label={`DTCP reads & writes ${"\u2195"}`} labelDx={-55}/>
    </g>))}
    <line x1={452} y1={180} x2={568} y2={180} stroke={C.accent} strokeWidth={2}/>
    <text x={510} y={172} textAnchor="middle" fill={C.accent} fontSize={8} fontWeight={600} fontFamily="monospace">{`Transfer PDUs ${"\u2192"}`}</text>
    <line x1={568} y1={490} x2={452} y2={490} stroke={C.green} strokeWidth={1.5} strokeDasharray="4,3"/>
    <text x={510} y={504} textAnchor="middle" fill={C.green} fontSize={8} fontWeight={600} fontFamily="monospace">{`${"\u2190"} Control PDUs (ACK/NACK)`}</text>
  </g>);

  const renderFlowAllocation = () => {
    const cols=[{x:100,label:"Source AP",color:C.cyan},{x:290,label:"Source IPCP",color:C.accent},{x:530,label:"DIF (NSM/CDAP)",color:C.purple},{x:740,label:"Dest IPCP",color:C.accent},{x:910,label:"Dest AP",color:C.cyan}];
    const steps=[
      {y:98,from:0,to:1,label:"1. Allocate_Request(dest-name, QoS)",color:C.green,desc:"AP requests flow; specifies dest AP name and QoS"},
      {y:142,from:1,to:1,label:"2. FA creates FAI, assigns src port-id",color:C.green,desc:"Flow Allocator Instance created; port-id returned"},
      {y:186,from:1,to:1,label:"3. FAI maps QoS params \u2192 policies + QoS-cube",color:C.orange,desc:"Decoupled: AP params \u2260 DIF policy selection"},
      {y:230,from:1,to:1,label:"4. Create EFCP (DTP + DTCP if needed)",color:C.accent,desc:"Before sending Create Flow \u2014 avoids race condition"},
      {y:274,from:1,to:2,label:"5. NSM: resolve dest-name \u2192 (N)-address",color:C.purple,desc:"Directory Forwarding Table (search rules)"},
      {y:318,from:1,to:3,label:"6. CDAP Create_Flow_Request",color:C.purple,desc:"AP names, QoS, policies, access control info"},
      {y:362,from:3,to:3,label:"7. Dest FA: check access control",color:C.rose,desc:"Does source AP have permission?"},
      {y:406,from:3,to:4,label:"8. Allocate_Request to dest AP",color:C.green,desc:"Notify dest AP of incoming flow request"},
      {y:450,from:4,to:3,label:"9. Allocate_Response (accept/reject)",color:C.green,desc:"Destination AP decides"},
      {y:494,from:3,to:3,label:"10. Create EFCP + assign dest port-id",color:C.accent,desc:"Dest FAI mirrors source; DTCP only if needed"},
      {y:538,from:3,to:1,label:"11. CDAP Create_Flow_Response",color:C.purple,desc:"Returns dest-address, CEP-ids, policies"},
      {y:582,from:1,to:1,label:"12. Bind port-ids \u2194 EFCPM CEP-ids",color:C.green,desc:"Flow = binding of connection to ports"},
      {y:626,from:1,to:0,label:"13. Allocate_Response(port-id, result)",color:C.green,desc:"AP can now Send/Receive using port-id"},
    ];
    return (<g>
      <text x={510} y={24} textAnchor="middle" fill={C.text} fontSize={14} fontWeight={700} fontFamily="monospace">Flow Allocation Sequence</text>
      <text x={510} y={40} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="sans-serif">Port allocation decoupled from EFCP synchronization {"\u2014"} no well-known ports</text>
      {cols.map(col=>(<g key={col.label}>
        <text x={col.x} y={68} textAnchor="middle" fill={col.color} fontSize={9} fontWeight={700} fontFamily="monospace">{col.label}</text>
        <line x1={col.x} y1={78} x2={col.x} y2={660} stroke={C.border} strokeWidth={0.8} strokeDasharray="3,3"/>
      </g>))}
      {steps.map((step,i)=>{
        const fx=cols[step.from].x,tx=cols[step.to].x,self=step.from===step.to;
        const labelX=self?fx+60:(fx<tx?tx+12:fx+12);
        return (<g key={i} style={{cursor:"pointer"}} onClick={()=>{
          const m={[C.green]:"flow_allocator",[C.accent]:"efcp",[C.purple]:"cdap",[C.rose]:"flow_allocator",[C.orange]:"flow_allocator"};
          show(m[step.color]||"flow_allocator");
        }}>
          {!self?(<>
            <defs><marker id={`fa${i}`} viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth={6} markerHeight={4} orient="auto-start-reverse"><polygon points="0 0, 10 3.5, 0 7" fill={step.color}/></marker></defs>
            <line x1={fx+(fx<tx?4:-4)} y1={step.y} x2={tx+(fx<tx?-4:4)} y2={step.y} stroke={step.color} strokeWidth={1.3} markerEnd={`url(#fa${i})`}/>
          </>):(<rect x={fx-40} y={step.y-7} width={80} height={14} rx={3} fill="none" stroke={step.color} strokeWidth={0.8} strokeDasharray="3,2"/>)}
          <text x={labelX} y={step.y-3} fill={step.color} fontSize={8.5} fontWeight={600} fontFamily="monospace" dominantBaseline="middle">{step.label}</text>
          <text x={labelX} y={step.y+10} fill={C.textMuted} fontSize={7.5} fontFamily="sans-serif" dominantBaseline="middle">{step.desc}</text>
        </g>);
      })}
    </g>);
  };

  const views={overview:{render:renderOverview,vb:"0 0 1020 670"},dataflow:{render:renderDataFlow,vb:"0 0 1060 720"},efcp:{render:renderEFCPDetail,vb:"0 0 1020 660"},allocation:{render:renderFlowAllocation,vb:"0 0 1020 680"}};
  const cur=views[view];

  return (
    <div style={{width:"100%",height:"100vh",background:C.bg,display:"flex",flexDirection:"column",position:"relative",overflow:"hidden"}}>
      <div style={{display:"flex",gap:6,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surface,zIndex:20,flexWrap:"wrap",alignItems:"center"}}>
        <NavBtn label="Architecture Overview" active={view==="overview"} onClick={()=>setView("overview")}/>
        <NavBtn label="Data Flow Path" active={view==="dataflow"} onClick={()=>setView("dataflow")}/>
        <NavBtn label="EFCP Internals" active={view==="efcp"} onClick={()=>setView("efcp")}/>
        <NavBtn label="Flow Allocation" active={view==="allocation"} onClick={()=>setView("allocation")}/>
        <div style={{flex:1}}/>
        <button onClick={resetView} style={{padding:"4px 8px",borderRadius:4,fontSize:9,cursor:"pointer",background:"transparent",color:C.textMuted,border:`1px solid ${C.border}`,fontFamily:"monospace"}}>Reset</button>
        <span style={{fontSize:9,color:C.textMuted,fontFamily:"monospace"}}>{Math.round(zoom*100)}%</span>
      </div>
      <div style={{flex:1,overflow:"hidden",position:"relative"}}>
        <Legend/>
        <svg ref={svgRef} width="100%" height="100%" viewBox={cur.vb} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} style={{cursor:isPanning.current?"grabbing":"grab"}}>
          <defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="15" cy="15" r="0.4" fill={C.border} opacity={0.25}/></pattern></defs>
          <rect width="100%" height="100%" fill={C.bg}/><rect width="100%" height="100%" fill="url(#grid)"/>
          <g transform={`translate(${pan.x/zoom},${pan.y/zoom}) scale(${zoom})`}>{cur.render()}</g>
        </svg>
        <div style={{position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",background:C.surfaceLight,border:`1px solid ${C.border}`,borderRadius:16,padding:"5px 14px",fontSize:10,color:C.textDim,pointerEvents:"none",whiteSpace:"nowrap"}}>
          <span style={{color:C.accent}}>{"\u27F3"}</span> Scroll to zoom {"\u00B7"} Drag to pan {"\u00B7"} Click components for spec details
        </div>
      </div>
      {info && <InfoPanel {...info} onClose={()=>setInfo(null)}/>}
    </div>
  );
}
