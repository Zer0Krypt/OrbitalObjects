// CelesTrak GP groups. Every group's element sets are merged into the catalog
// (so retired constellations like Molniya are included), and each object is
// tagged with the groups it belongs to so the UI can filter by mission/purpose.
// [key, label, category]
export const GROUPS = [
  ['stations', 'Space Stations', 'Special'],
  ['visual', '100 Brightest', 'Special'],
  ['last-30-days', 'Launched in Last 30 Days', 'Special'],
  ['analyst', 'Analyst Objects', 'Special'],

  ['weather', 'Weather', 'Earth Observation'],
  ['noaa', 'NOAA', 'Earth Observation'],
  ['goes', 'GOES', 'Earth Observation'],
  ['resource', 'Earth Resources', 'Earth Observation'],
  ['sarsat', 'Search & Rescue', 'Earth Observation'],
  ['dmc', 'Disaster Monitoring', 'Earth Observation'],
  ['tdrss', 'Tracking & Data Relay', 'Earth Observation'],
  ['argos', 'ARGOS Data Collection', 'Earth Observation'],
  ['planet', 'Planet Labs', 'Earth Observation'],
  ['spire', 'Spire', 'Earth Observation'],

  ['geo', 'Geostationary', 'Communications'],
  ['intelsat', 'Intelsat', 'Communications'],
  ['ses', 'SES', 'Communications'],
  ['eutelsat', 'Eutelsat', 'Communications'],
  ['iridium-NEXT', 'Iridium NEXT', 'Communications'],
  ['starlink', 'Starlink', 'Communications'],
  ['oneweb', 'OneWeb', 'Communications'],
  ['kuiper', 'Project Kuiper', 'Communications'],
  ['qianfan', 'Qianfan', 'Communications'],
  ['orbcomm', 'ORBCOMM', 'Communications'],
  ['globalstar', 'Globalstar', 'Communications'],
  ['swarm', 'Swarm', 'Communications'],
  ['amateur', 'Amateur Radio', 'Communications'],
  ['x-comm', 'Experimental Comms', 'Communications'],
  ['other-comm', 'Other Comms', 'Communications'],
  ['satnogs', 'SatNOGS', 'Communications'],
  ['gorizont', 'Gorizont', 'Communications'],
  ['raduga', 'Raduga', 'Communications'],
  ['molniya', 'Molniya', 'Communications'],

  ['gnss', 'GNSS', 'Navigation'],
  ['gps-ops', 'GPS Operational', 'Navigation'],
  ['glo-ops', 'GLONASS Operational', 'Navigation'],
  ['galileo', 'Galileo', 'Navigation'],
  ['beidou', 'BeiDou', 'Navigation'],
  ['sbas', 'SBAS', 'Navigation'],
  ['nnss', 'Navy Navigation (NNSS)', 'Navigation'],
  ['musson', 'Russian LEO Navigation', 'Navigation'],

  ['science', 'Space & Earth Science', 'Science'],
  ['geodetic', 'Geodetic', 'Science'],
  ['engineering', 'Engineering', 'Science'],
  ['education', 'Education', 'Science'],

  ['military', 'Military', 'Military'],
  ['radar', 'Radar Calibration', 'Military'],

  ['cubesat', 'CubeSats', 'Other'],
  ['other', 'Other', 'Other'],

  ['cosmos-1408-debris', 'Cosmos 1408 ASAT Debris', 'Debris Events'],
  ['fengyun-1c-debris', 'Fengyun-1C ASAT Debris', 'Debris Events'],
  ['iridium-33-debris', 'Iridium 33 Collision Debris', 'Debris Events'],
  ['cosmos-2251-debris', 'Cosmos 2251 Collision Debris', 'Debris Events'],
];
