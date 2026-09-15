// A small, self-contained municipal zoning code corpus and example applications.
// This stands in for a real code database — swap for a real one in production.

window.ZONING_CODE = [
  { id: "ZN-101", zone: "R-1", topic: "front setback", dimension: "front_setback_ft", rule: "min", value: 25, unit: "ft",
    text: "Section 4.2.1 — R-1 Single-Family District: No principal structure shall be located within twenty-five (25) feet of the front property line abutting a public street." },
  { id: "ZN-102", zone: "R-1", topic: "side setback", dimension: "side_setback_ft", rule: "min", value: 8, unit: "ft",
    text: "Section 4.2.2 — R-1 Single-Family District: Interior side yard setbacks shall be no less than eight (8) feet." },
  { id: "ZN-103", zone: "R-1", topic: "rear setback", dimension: "rear_setback_ft", rule: "min", value: 15, unit: "ft",
    text: "Section 4.2.3 — R-1 Single-Family District: Rear yard setbacks shall be no less than fifteen (15) feet." },
  { id: "ZN-104", zone: "R-1", topic: "building height", dimension: "height_ft", rule: "max", value: 30, unit: "ft",
    text: "Section 4.3.1 — R-1 Single-Family District: Maximum structure height shall not exceed thirty (30) feet or two and one-half stories, whichever is less." },
  { id: "ZN-105", zone: "R-1", topic: "lot coverage", dimension: "coverage_pct", rule: "max", value: 40, unit: "%",
    text: "Section 4.4.1 — R-1 Single-Family District: Total building coverage, including all additions and accessory structures, shall not exceed forty percent (40%) of total lot area." },
  { id: "ZN-106", zone: "R-1", topic: "corner lot secondary frontage setback", dimension: "secondary_front_setback_ft", rule: "min", value: 15, unit: "ft",
    text: "Section 4.2.5 — Corner Lots: On a corner lot, the setback from the secondary street frontage shall be no less than fifteen (15) feet, independent of the standard interior side setback on the opposite side of the lot." },
  { id: "ZN-107", zone: "R-1", topic: "accessory structure setback", dimension: "accessory_setback_ft", rule: "min", value: 5, unit: "ft",
    text: "Section 4.5.2 — Accessory Structures: Detached garages, sheds, and other accessory buildings shall maintain a minimum setback of five (5) feet from any interior side or rear property line." },
  { id: "ZN-108", zone: "Historic Overlay", topic: "historic overlay design review", dimension: null, rule: "human", value: null, unit: null,
    text: "Section 9.1.1 — Heritage Row Historic Overlay District: Any exterior alteration visible from a public right-of-way, including porches, facades, and rooflines, requires review and approval by the Design Review Board regardless of dimensional compliance with underlying district standards." },
  { id: "ZN-109", zone: "General", topic: "fence height", dimension: "fence_height_ft", rule: "max", value: 6, unit: "ft",
    text: "Section 4.6.1 — All Districts: Fences located in rear or interior side yards shall not exceed six (6) feet in height; front-yard fences are limited to four (4) feet." },
  { id: "ZN-110", zone: "General", topic: "home occupation permit", dimension: null, rule: "human", value: null, unit: null,
    text: "Section 5.3.1 — All Districts: Home occupations generating client visits, deliveries, or on-site non-resident employees require a Conditional Use Permit reviewed by planning staff." }
];

window.EXAMPLES = [
  {
    id: "maple",
    label: "123 Maple St. — Rear Addition",
    text: "Hi, I'm the homeowner at 123 Maple Street, zoned R-1. I'd like to add a 400 sq ft single-story family room addition on the east side of my house. The new wall would sit about 12 feet from the east property line. The lot is 9,200 sq ft total and currently has 3,150 sq ft of building coverage before the addition. The addition would be 14 feet tall at the roof peak. Please let me know if this can be approved."
  },
  {
    id: "corner",
    label: "88 Corner Ave. — Corner Lot Garage",
    text: "This is for 88 Corner Avenue, an R-1 corner lot with frontage on both Corner Ave and 3rd St. We want to build a detached 2-car garage near the 3rd St side, about 9 feet back from that property line. Lot size is 7,800 sq ft, existing building coverage 2,600 sq ft, garage height 16 ft, and the interior side setback on the east side would be 10 ft."
  },
  {
    id: "heritage",
    label: "5 Heritage Row — Porch Rebuild",
    text: "Property at 5 Heritage Row, inside the designated Heritage Row Historic Overlay district (R-1 underlying zoning). Owner wants to rebuild the existing front porch, extending it 6 feet further toward the street, ending up 26 feet from the front property line. Lot is 6,000 sq ft, current building coverage 2,100 sq ft, no height change (single story, 12 ft)."
  }
];
