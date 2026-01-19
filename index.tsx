import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Map, BarChart3, Layers, Info, MapPin, Users, Vote, Filter, X, Menu, Upload, AlertCircle, Building2, CheckCircle2 } from 'lucide-react';

// --- Types & Interfaces ---

interface Candidate {
  id: string;
  name: string;
  party: string;
  color: string;
  avatar: string;
}

interface PollingStation {
  id: string;
  name: string;
  comunaName: string;
  corporation: string; // 'Senado' | 'Cámara' | etc.
  lat: number;
  lng: number;
  isApproximate: boolean; // True if calculated from Comuna centroid
  potentialVoters: number;
  votes: Record<string, number>; // candidateName -> votes
  totalVotes: number;
  winnerName: string;
}

// --- CONSTANTS & GEO DATA ---

// Centroids for Medellín Comunas & Corregimientos (Fallback logic)
const MEDELLIN_GEO_FALLBACK: Record<string, { lat: number, lng: number }> = {
  'popular': { lat: 6.292, lng: -75.545 },
  'santa cruz': { lat: 6.299, lng: -75.558 },
  'manrique': { lat: 6.275, lng: -75.550 },
  'aranjuez': { lat: 6.280, lng: -75.558 },
  'castilla': { lat: 6.290, lng: -75.575 },
  'doce de octubre': { lat: 6.305, lng: -75.585 },
  'robledo': { lat: 6.280, lng: -75.600 },
  'villa hermosa': { lat: 6.260, lng: -75.550 },
  'buenos aires': { lat: 6.240, lng: -75.550 },
  'la candelaria': { lat: 6.250, lng: -75.570 },
  'centro': { lat: 6.250, lng: -75.570 }, // Alias for Candelaria
  'laureles': { lat: 6.245, lng: -75.590 },
  'laureles estadio': { lat: 6.245, lng: -75.590 },
  'la america': { lat: 6.255, lng: -75.605 },
  'la américa': { lat: 6.255, lng: -75.605 },
  'san javier': { lat: 6.255, lng: -75.615 },
  'poblado': { lat: 6.205, lng: -75.570 },
  'el poblado': { lat: 6.205, lng: -75.570 },
  'guayabal': { lat: 6.220, lng: -75.585 },
  'belen': { lat: 6.225, lng: -75.595 },
  'belén': { lat: 6.225, lng: -75.595 },
  'san cristobal': { lat: 6.278, lng: -75.635 },
  'san cristóbal': { lat: 6.278, lng: -75.635 },
  'palmitas': { lat: 6.340, lng: -75.680 },
  'san sebastian de palmitas': { lat: 6.340, lng: -75.680 },
  'altavista': { lat: 6.210, lng: -75.630 },
  'san antonio de prado': { lat: 6.185, lng: -75.650 },
  'santa elena': { lat: 6.210, lng: -75.500 }
};

const PARTY_COLORS: Record<string, string> = {
  'pacto historico': '#7c3aed', // Purple
  'pacto histórico': '#7c3aed',
  'centro democratico': '#3b82f6', // Blue
  'centro democrático': '#3b82f6',
  'partido liberal': '#ef4444', // Red
  'partido conservador': '#1e40af', // Dark Blue
  'cambio radical': '#be123c', // Rose
  'partido de la u': '#f97316', // Orange
  'alianza verde': '#10b981', // Emerald
  'mira': '#0ea5e9', // Sky
  'liga gobernantes': '#eab308', // Yellow
  'voto en blanco': '#94a3b8', // Gray
  'default': '#64748b'
};

// Initial Data Sample (Legislative focus)
const INITIAL_CSV_DATA = `corporacion,puesto,comuna,candidato,partido,votos,lat,lng,potencial
Senado,Universidad EAFIT,El Poblado,Lista Pacto Histórico,Pacto Histórico,2500,6.2008,-75.5786,8000
Senado,Universidad EAFIT,El Poblado,Lista Centro Democrático,Centro Democrático,3200,6.2008,-75.5786,8000
Senado,Universidad EAFIT,El Poblado,Lista Partido Liberal,Partido Liberal,800,6.2008,-75.5786,8000
Senado,Universidad UPB,Laureles,Lista Centro Democrático,Centro Democrático,2800,6.2424,-75.5894,7500
Senado,Universidad UPB,Laureles,Lista Alianza Verde,Alianza Verde,1500,6.2424,-75.5894,7500
Cámara,INEM José Félix,Poblado,Susana Boreal,Pacto Histórico,1200,6.2195,-75.5830,6000
Cámara,INEM José Félix,Poblado,Daniel Carvalho,Alianza Verde,1100,6.2195,-75.5830,6000
Cámara,Estadio Atanasio,Estadio,Mauricio Parodi,Cambio Radical,900,,,9000
Cámara,Estadio Atanasio,Estadio,Daniel Restrepo,Partido Conservador,1400,,,9000
Senado,Plaza Minorista,La Candelaria,Lista Pacto Histórico,Pacto Histórico,1800,6.2520,-75.5730,5000
Senado,Plaza Minorista,La Candelaria,Lista Partido Liberal,Partido Liberal,1600,6.2520,-75.5730,5000`;

// --- Utils ---

const getColorForParty = (party: string) => {
  const normalized = party.toLowerCase().trim();
  return PARTY_COLORS[normalized] || PARTY_COLORS['default'];
};

const parseCSV = (csvText: string): { stations: PollingStation[], candidates: Candidate[], comunas: string[], corporations: string[], loadReport: any } => {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error("Archivo vacío o incompleto");

  // Intelligent Header Detection
  const headerLine = lines[0].toLowerCase();
  const sep = headerLine.includes(';') ? ';' : ','; // Detect delimiter
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ''));
  
  // Map columns flexibly
  const getIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
  
  const idx = {
    puesto: getIdx(['puesto', 'lugar', 'ubica']),
    comuna: getIdx(['comuna', 'zona', 'localidad']),
    corporacion: getIdx(['corporacion', 'cuerpo', 'eleccion']),
    candidato: getIdx(['candidato', 'nombre', 'lista']),
    partido: getIdx(['partido', 'movimiento']),
    votos: getIdx(['votos', 'cantidad', 'resultado']),
    lat: getIdx(['lat', 'norte']),
    lng: getIdx(['lng', 'lon', 'este']),
    potencial: getIdx(['potencial', 'habilitados', 'censo'])
  };

  if (idx.puesto === -1 || idx.votos === -1) {
    throw new Error("Columnas mínimas requeridas: 'Puesto' y 'Votos'.");
  }

  const stationsMap: Record<string, PollingStation> = {};
  const candidatesMap: Record<string, Candidate> = {};
  const comunasSet = new Set<string>();
  const corporationsSet = new Set<string>();
  
  let exactLocations = 0;
  let approximatedLocations = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(sep).map(c => c.trim().replace(/"/g, ''));
    if (row.length < 2) continue;

    const puestoName = row[idx.puesto];
    const comunaName = idx.comuna !== -1 ? (row[idx.comuna] || 'Desconocida') : 'Desconocida';
    const corpName = idx.corporacion !== -1 ? (row[idx.corporacion] || 'General') : 'General';
    const candName = idx.candidato !== -1 ? row[idx.candidato] : 'Desconocido';
    const partyName = idx.partido !== -1 ? row[idx.partido] : 'Independiente';
    const votos = parseInt(row[idx.votos]) || 0;
    
    // Key to group stations (Name + Comuna + Corporation)
    // We group by corporation too because sometimes stations are listed differently for Senate vs Chamber
    const stationKey = `${puestoName}-${comunaName}-${corpName}`.toLowerCase().replace(/\s+/g, '-');

    comunasSet.add(comunaName);
    corporationsSet.add(corpName);

    // Get Candidates
    const candId = `${candName}-${partyName}`.toLowerCase().replace(/\s+/g, '-');
    if (!candidatesMap[candId]) {
      candidatesMap[candId] = {
        id: candId,
        name: candName,
        party: partyName,
        color: getColorForParty(partyName),
        avatar: candName.substring(0, 2).toUpperCase()
      };
    }

    // Init Station
    if (!stationsMap[stationKey]) {
      let lat = idx.lat !== -1 ? parseFloat(row[idx.lat]) : NaN;
      let lng = idx.lng !== -1 ? parseFloat(row[idx.lng]) : NaN;
      let isApproximate = false;

      // Geolocation Fallback Logic
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
        // Try to find by comuna
        const normalizedComuna = comunaName.toLowerCase().trim();
        const fallback = MEDELLIN_GEO_FALLBACK[normalizedComuna] 
           || Object.entries(MEDELLIN_GEO_FALLBACK).find(([k]) => normalizedComuna.includes(k))?.[1];

        if (fallback) {
          // Add Jitter: +/- 0.003 degrees (~300m) to allow distinct clicking
          lat = fallback.lat + (Math.random() - 0.5) * 0.006;
          lng = fallback.lng + (Math.random() - 0.5) * 0.006;
          isApproximate = true;
          approximatedLocations++;
        } else {
          // Final fallback: Center of Medellín with wider jitter
          lat = 6.2476 + (Math.random() - 0.5) * 0.02;
          lng = -75.5658 + (Math.random() - 0.5) * 0.02;
          isApproximate = true;
          approximatedLocations++;
        }
      } else {
        exactLocations++;
      }

      stationsMap[stationKey] = {
        id: stationKey,
        name: puestoName,
        comunaName,
        corporation: corpName,
        lat,
        lng,
        isApproximate,
        potentialVoters: idx.potencial !== -1 ? parseInt(row[idx.potencial]) || 0 : 0,
        votes: {},
        totalVotes: 0,
        winnerName: ''
      };
    }

    // Add Votes
    if (!stationsMap[stationKey].votes[candName]) {
      stationsMap[stationKey].votes[candName] = 0;
    }
    stationsMap[stationKey].votes[candName] += votos;
    stationsMap[stationKey].totalVotes += votos;
  }

  // Calculate winners & fallback potentials
  Object.values(stationsMap).forEach(s => {
    let maxV = -1;
    let winner = 'N/A';
    Object.entries(s.votes).forEach(([c, v]) => {
      if (v > maxV) { maxV = v; winner = c; }
    });
    s.winnerName = winner;
    if (s.potentialVoters === 0) s.potentialVoters = Math.round(s.totalVotes * 1.5); // Estimate
  });

  return {
    stations: Object.values(stationsMap),
    candidates: Object.values(candidatesMap),
    comunas: Array.from(comunasSet).sort(),
    corporations: Array.from(corporationsSet).sort(),
    loadReport: { exact: exactLocations, approx: approximatedLocations, total: Object.keys(stationsMap).length }
  };
};

// --- Components ---

const FileUploadModal = ({ onUpload, onClose }: { onUpload: (data: string) => void, onClose: () => void }) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setError('Por favor sube un archivo CSV válido.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        onUpload(text);
        onClose();
      } catch (err) {
        setError('Error al leer el archivo.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in duration-200">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        
        <div className="flex items-center space-x-2 mb-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-800">Cargar Datos - Consultora Talleyrand</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">Sube tu archivo CSV con resultados electorales. El sistema intentará georreferenciar automáticamente los puestos sin coordenadas basándose en la Comuna.</p>
        
        <div 
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-400'}`}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
          }}
        >
          <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-slate-700 mb-1">Arrastra tu CSV aquí</p>
          <p className="text-sm text-slate-400 mb-6">o haz clic para explorar tus archivos</p>
          
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            id="csv-upload"
            onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
            }}
          />
          <label 
            htmlFor="csv-upload"
            className="inline-block px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 cursor-pointer shadow-md hover:shadow-lg transition-all"
          >
            Seleccionar Archivo
          </label>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center border border-red-100">
             <AlertCircle className="w-4 h-4 mr-2" />
             {error}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500">
          <p className="font-semibold mb-2">Formato recomendado (flexible):</p>
          <code className="block bg-slate-100 p-2 rounded text-slate-600 font-mono">
            Corporacion, Puesto, Comuna, Candidato, Partido, Votos, [Lat], [Lng]
          </code>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, subtext, icon: Icon, color }: any) => (
  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-start space-x-4 hover:shadow-md transition-shadow">
    <div className={`p-3 rounded-lg ${color} bg-opacity-10 text-${color.replace('bg-', '')}`}>
      <Icon className={`w-6 h-6 text-${color.replace('bg-', '')}-600`} />
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium">{title}</p>
      <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
  </div>
);

const CandidateBar = ({ candidate, votes, total }: { candidate: Candidate, votes: number, total: number }) => {
  const percentage = total > 0 ? (votes / total) * 100 : 0;
  return (
    <div className="mb-4 group">
      <div className="flex justify-between items-end mb-1">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ring-2 ring-white" style={{ backgroundColor: candidate.color }}>
            {candidate.avatar}
          </div>
          <div>
            <span className="text-sm font-semibold text-slate-700 block group-hover:text-blue-600 transition-colors">{candidate.name}</span>
            <span className="text-xs text-slate-400 block">{candidate.party}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-slate-700">{votes.toLocaleString()}</span>
          <span className="text-xs text-slate-500 ml-1">({percentage.toFixed(1)}%)</span>
        </div>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div 
          className="h-2.5 rounded-full transition-all duration-1000 ease-out relative" 
          style={{ width: `${percentage}%`, backgroundColor: candidate.color }}
        >
             <div className="absolute inset-0 bg-white opacity-20 group-hover:opacity-0 transition-opacity"></div>
        </div>
      </div>
    </div>
  );
};

const MapComponent = ({ 
  stations, 
  candidates,
  onSelectStation, 
  selectedStationId,
  viewLayer
}: { 
  stations: PollingStation[], 
  candidates: Candidate[],
  onSelectStation: (s: PollingStation) => void,
  selectedStationId: string | null,
  viewLayer: 'markers' | 'winner'
}) => {
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      // Initialize Map - Center on Medellín
      const map = (window as any).L.map(mapContainerRef.current, {
        zoomControl: false
      }).setView([6.2476, -75.5658], 13);
      
      // Controls
      (window as any).L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Light tile layer
      (window as any).L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      mapRef.current = map;
    }

    // Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Add Markers
    stations.forEach(station => {
      // Find winner object
      const winnerName = station.winnerName;
      const winner = candidates.find(c => c.name === winnerName);
      
      const color = viewLayer === 'winner' ? (winner?.color || '#94a3b8') : '#3b82f6';
      
      // Calculate radius
      const radius = viewLayer === 'winner' 
        ? Math.max(5, Math.min(15, Math.sqrt(station.totalVotes) / 3)) 
        : 6;

      const markerOptions = {
        radius: radius,
        fillColor: color,
        color: station.isApproximate ? '#f59e0b' : '#fff', // Orange border if approximate
        weight: station.isApproximate ? 2 : 1,
        dashArray: station.isApproximate ? '2, 2' : null,
        opacity: 1,
        fillOpacity: 0.85
      };

      const marker = (window as any).L.circleMarker([station.lat, station.lng], markerOptions).addTo(mapRef.current);

      // Styled Popup
      marker.bindPopup(`
        <div class="p-3 font-sans">
          <div class="font-bold text-slate-800 text-sm mb-0.5 leading-tight">${station.name}</div>
          <div class="text-[10px] text-slate-500 uppercase tracking-wide mb-2">${station.comunaName} ${station.isApproximate ? '(Ubic. Aprox)' : ''}</div>
          
          <div class="flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-100 mb-2">
             <div>
                <span class="text-[10px] text-slate-400 block">Ganador</span>
                <span class="text-xs font-bold" style="color:${winner?.color || '#333'}">${winnerName}</span>
             </div>
             <div class="text-right">
                <span class="text-[10px] text-slate-400 block">Votos</span>
                <span class="text-xs font-bold text-slate-700">${station.totalVotes}</span>
             </div>
          </div>
          
          <button class="mt-1 w-full text-xs bg-blue-600 text-white font-medium py-1.5 rounded hover:bg-blue-700 transition-colors shadow-sm" onclick="window.dispatchEvent(new CustomEvent('station-select', {detail: '${station.id}'}))">
            Ver Detalles
          </button>
        </div>
      `);

      marker.on('click', () => {
         onSelectStation(station);
      });

      markersRef.current.push(marker);
    });
    
    // Fit bounds if we have stations
    if (stations.length > 0 && mapRef.current) {
        const bounds = (window as any).L.latLngBounds(stations.map(s => [s.lat, s.lng]));
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }

  }, [stations, candidates, viewLayer]);

  return <div ref={mapContainerRef} className="h-full w-full z-0 bg-slate-100" />;
};

const DashboardApp = () => {
  const [data, setData] = useState<{ stations: PollingStation[], candidates: Candidate[], comunas: string[], corporations: string[], loadReport: any } | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'dashboard'>('map');
  
  // Filters
  const [selectedComuna, setSelectedComuna] = useState<string>('');
  const [selectedCorporation, setSelectedCorporation] = useState<string>('');
  
  const [selectedStation, setSelectedStation] = useState<PollingStation | null>(null);
  const [viewLayer, setViewLayer] = useState<'markers' | 'winner'>('winner');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showLoadSuccess, setShowLoadSuccess] = useState(false);

  // Initialize with sample data
  useEffect(() => {
    try {
      const parsed = parseCSV(INITIAL_CSV_DATA);
      setData(parsed);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Listen for popup clicks
  useEffect(() => {
    const handleStationSelect = (e: any) => {
      if (!data) return;
      const station = data.stations.find(s => s.id === e.detail);
      if (station) {
        setSelectedStation(station);
        setIsSidebarOpen(true);
        setActiveTab('map'); // Ensure we stay on map
      }
    };
    window.addEventListener('station-select', handleStationSelect);
    return () => window.removeEventListener('station-select', handleStationSelect);
  }, [data]);

  const handleCsvUpload = (csvText: string) => {
    try {
      const parsed = parseCSV(csvText);
      setData(parsed);
      setSelectedComuna('');
      setSelectedCorporation('');
      setSelectedStation(null);
      setShowLoadSuccess(true);
      setTimeout(() => setShowLoadSuccess(false), 5000);
    } catch (e) {
      alert("Error al procesar el CSV. Verifica que tenga las columnas correctas.");
    }
  };

  // Safe checks
  if (!data) return <div className="flex h-screen items-center justify-center text-slate-500 animate-pulse">Iniciando sistema electoral...</div>;

  // Filter Data
  const filteredStations = useMemo(() => {
    return data.stations.filter(s => {
        const matchesComuna = selectedComuna ? s.comunaName === selectedComuna : true;
        const matchesCorp = selectedCorporation ? s.corporation === selectedCorporation : true;
        return matchesComuna && matchesCorp;
    });
  }, [data, selectedComuna, selectedCorporation]);

  // Aggregate Data
  const aggregatedStats = useMemo(() => {
    const stats = {
      totalVotes: 0,
      potentialVoters: 0,
      votesByCandidate: {} as Record<string, number>
    };
    
    // Initialize with known candidates to ensure 0s are shown if candidates exist in metadata
    data.candidates.forEach(c => stats.votesByCandidate[c.name] = 0);

    filteredStations.forEach(s => {
      stats.totalVotes += s.totalVotes;
      stats.potentialVoters += s.potentialVoters;
      Object.entries(s.votes).forEach(([cName, count]) => {
        if (stats.votesByCandidate[cName] !== undefined) {
          stats.votesByCandidate[cName] += count;
        } else {
            stats.votesByCandidate[cName] = count;
        }
      });
    });

    return stats;
  }, [filteredStations, data]);

  // Find winner
  let winningCandidateName = 'N/A';
  let maxVotes = -1;
  Object.entries(aggregatedStats.votesByCandidate).forEach(([name, count]) => {
      if (count > maxVotes) {
          maxVotes = count;
          winningCandidateName = name;
      }
  });
  
  const winningCandidate = data.candidates.find(c => c.name === winningCandidateName);
  const participationRate = aggregatedStats.potentialVoters > 0 
    ? ((aggregatedStats.totalVotes / aggregatedStats.potentialVoters) * 100).toFixed(1)
    : '0';

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden font-sans">
      
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 z-30 shadow-sm relative">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-br from-blue-700 to-blue-900 p-2 rounded-lg shadow-lg">
             <Vote className="text-white w-5 h-5" />
          </div>
          <div>
             <h1 className="text-lg font-bold text-slate-900 leading-tight tracking-tight">Elecciones 2023</h1>
             <p className="text-xs text-slate-500 font-medium">Cámara y Senado - Medellín</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
            {/* Branding - Header */}
            <div className="hidden lg:block text-right mr-4 border-r border-slate-100 pr-4">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Powered By</p>
                <p className="text-xs font-bold text-blue-900">Consultora Talleyrand</p>
            </div>

            <button 
                onClick={() => setShowUploadModal(true)}
                className="flex items-center space-x-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition-all border border-blue-200"
            >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Cargar CSV</span>
            </button>

            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button 
                    onClick={() => setActiveTab('map')}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'map' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <MapPin className="w-4 h-4" />
                    <span className="hidden sm:inline">Mapa</span>
                </button>
                <button 
                    onClick={() => setActiveTab('dashboard')}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <BarChart3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Resultados</span>
                </button>
            </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar */}
        <aside 
          className={`
            absolute top-0 bottom-0 left-0 w-full sm:w-80 bg-white border-r border-slate-200 z-20 transition-transform duration-300 ease-in-out flex flex-col shadow-xl sm:shadow-none
            ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            ${activeTab === 'dashboard' ? 'hidden' : 'block'} 
            sm:relative sm:translate-x-0
          `}
        >
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h2 className="font-bold text-slate-700 flex items-center text-sm uppercase tracking-wide">
              <Filter className="w-4 h-4 mr-2 text-blue-500" /> Filtros
            </h2>
            <button onClick={() => setIsSidebarOpen(false)} className="sm:hidden text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-6">
            
            {/* Filters */}
            <div className="space-y-4">
              <div className="space-y-1">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Corporación</label>
                 <select 
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                    value={selectedCorporation}
                    onChange={(e) => { setSelectedCorporation(e.target.value); setSelectedStation(null); }}
                  >
                    <option value="">Todas (Senado y Cámara)</option>
                    {data.corporations.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
              </div>

              <div className="space-y-1">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Zona / Comuna</label>
                 <select 
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                    value={selectedComuna}
                    onChange={(e) => { setSelectedComuna(e.target.value); setSelectedStation(null); }}
                  >
                    <option value="">Medellín (Total)</option>
                    {data.comunas.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
              </div>
            </div>

            {/* View Mode */}
            <div className="p-1 bg-slate-100 rounded-lg flex">
                 <button 
                    onClick={() => setViewLayer('winner')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${viewLayer === 'winner' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
                 >
                   Mapa de Calor
                 </button>
                 <button 
                    onClick={() => setViewLayer('markers')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${viewLayer === 'markers' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
                 >
                   Puntos
                 </button>
            </div>

            <hr className="border-slate-100" />

            {/* Context Stats */}
            {selectedStation ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                 <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg mb-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-1">
                        <MapPin className="w-12 h-12 text-blue-200 -mt-2 -mr-2 opacity-50" />
                    </div>
                    <div className="relative z-10">
                        <h3 className="font-bold text-blue-900 leading-tight">{selectedStation.name}</h3>
                        <p className="text-xs text-blue-600 mt-1 flex items-center">
                            {selectedStation.corporation} • {selectedStation.comunaName}
                        </p>
                        <button onClick={() => setSelectedStation(null)} className="text-[10px] font-bold text-blue-500 mt-2 underline decoration-blue-300 hover:text-blue-700">
                            Volver al Resumen
                        </button>
                    </div>
                 </div>
                 
                 <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Resultados en Puesto</h4>
                    {data.candidates.map(cand => {
                        const votes = selectedStation.votes[cand.name] || 0;
                        if (votes === 0) return null;
                        return (
                            <CandidateBar 
                                key={cand.id} 
                                candidate={cand} 
                                votes={votes} 
                                total={selectedStation.totalVotes} 
                            />
                        );
                    })}
                 </div>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="mb-4">
                   <h3 className="font-bold text-slate-800 text-sm uppercase">
                      Resultados {selectedCorporation || 'Generales'}
                   </h3>
                   <p className="text-xs text-slate-500">
                     {selectedComuna || 'Toda la ciudad'} • {filteredStations.length} Puestos
                   </p>
                </div>
                
                <div className="space-y-2">
                  {data.candidates
                     .filter(c => aggregatedStats.votesByCandidate[c.name] > 0)
                     .sort((a,b) => aggregatedStats.votesByCandidate[b.name] - aggregatedStats.votesByCandidate[a.name])
                     .slice(0, 8) // Top 8 for sidebar
                     .map(cand => (
                    <CandidateBar 
                      key={cand.id} 
                      candidate={cand} 
                      votes={aggregatedStats.votesByCandidate[cand.name]} 
                      total={aggregatedStats.totalVotes} 
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer Branding */}
          <div className="p-4 border-t border-slate-100 bg-slate-50 text-center">
             <p className="text-[10px] text-slate-400 font-medium">Desarrollado por</p>
             <p className="text-sm font-bold text-slate-700 tracking-tight">Consultora Talleyrand</p>
          </div>
        </aside>

        {/* Mobile Sidebar Toggle */}
        {!isSidebarOpen && activeTab === 'map' && (
           <button 
             onClick={() => setIsSidebarOpen(true)}
             className="absolute top-4 left-4 z-10 bg-white p-2.5 rounded-full shadow-lg border border-slate-100 text-blue-600 sm:hidden hover:bg-blue-50"
           >
             <Menu className="w-5 h-5" />
           </button>
        )}

        {/* Main Content Area */}
        <main className={`flex-1 relative ${activeTab === 'map' ? 'h-full' : 'h-full overflow-y-auto bg-slate-50'}`}>
          
          {activeTab === 'map' ? (
             <MapComponent 
               stations={filteredStations} 
               candidates={data.candidates}
               onSelectStation={setSelectedStation} 
               selectedStationId={selectedStation?.id || null}
               viewLayer={viewLayer}
             />
          ) : (
             /* Dashboard View */
             <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Tablero de Control</h2>
                    <p className="text-slate-500 mt-1">Análisis detallado de votaciones Cámara y Senado</p>
                  </div>
                  
                  {/* Dashboard Filters */}
                  <div className="flex space-x-2 bg-white p-1.5 rounded-lg shadow-sm border border-slate-200">
                     <select 
                        className="bg-transparent text-sm px-2 font-medium text-slate-700 outline-none"
                        value={selectedCorporation}
                        onChange={(e) => setSelectedCorporation(e.target.value)}
                      >
                        <option value="">Corporación: Todas</option>
                        {data.corporations.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <div className="w-px bg-slate-200"></div>
                      <select 
                        className="bg-transparent text-sm px-2 font-medium text-slate-700 outline-none"
                        value={selectedComuna}
                        onChange={(e) => setSelectedComuna(e.target.value)}
                      >
                        <option value="">Zona: Medellín</option>
                        {data.comunas.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                  </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <StatCard 
                      title="Votos Contabilizados" 
                      value={aggregatedStats.totalVotes.toLocaleString()} 
                      subtext={`${filteredStations.length} puestos de votación activos`}
                      icon={Vote}
                      color="bg-blue-500"
                   />
                   <StatCard 
                      title="Participación Estimada" 
                      value={`${participationRate}%`} 
                      subtext={`Censo aprox: ${aggregatedStats.potentialVoters.toLocaleString()}`}
                      icon={Users}
                      color="bg-emerald-500"
                   />
                   <StatCard 
                      title="Fuerza Política Líder" 
                      value={winningCandidate?.name || 'N/A'} 
                      subtext={winningCandidate?.party || 'Sin datos'}
                      icon={CheckCircle2} 
                      color="bg-purple-500"
                   />
                </div>

                {/* Charts Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   
                   {/* Main Bar Chart */}
                   <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                      <h3 className="font-bold text-lg text-slate-800 mb-6 flex items-center">
                        <BarChart3 className="w-5 h-5 mr-2 text-slate-400" />
                        Resultados Consolidados
                      </h3>
                      <div className="space-y-1">
                        {data.candidates
                            .filter(c => aggregatedStats.votesByCandidate[c.name] > 0)
                            .sort((a,b) => aggregatedStats.votesByCandidate[b.name] - aggregatedStats.votesByCandidate[a.name])
                            .map(cand => (
                            <CandidateBar 
                            key={cand.id} 
                            candidate={cand} 
                            votes={aggregatedStats.votesByCandidate[cand.name]} 
                            total={aggregatedStats.totalVotes} 
                            />
                        ))}
                      </div>
                   </div>

                   {/* Geo Breakdown */}
                   <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[500px]">
                      <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center">
                        <Map className="w-5 h-5 mr-2 text-slate-400" />
                        Distribución Zonal
                      </h3>
                      <div className="flex-1 overflow-y-auto custom-scroll pr-2 -mr-2">
                         <table className="w-full text-sm text-left border-collapse">
                           <thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10">
                             <tr>
                               <th className="px-3 py-2 rounded-tl-lg">Zona</th>
                               <th className="px-3 py-2 text-right rounded-tr-lg">Votos</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                             {data.comunas.map(comunaName => {
                               // Calculate stats for this specific comuna row
                               const cStations = data.stations.filter(s => {
                                   const matchComuna = s.comunaName === comunaName;
                                   const matchCorp = selectedCorporation ? s.corporation === selectedCorporation : true;
                                   return matchComuna && matchCorp;
                               });
                               const cVotes = cStations.reduce((acc, s) => acc + s.totalVotes, 0);
                               if (cVotes === 0) return null;

                               return (
                                 <tr key={comunaName} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => { setSelectedComuna(comunaName); setActiveTab('map'); }}>
                                    <td className="px-3 py-2.5 font-medium text-slate-700 group-hover:text-blue-600">{comunaName}</td>
                                    <td className="px-3 py-2.5 text-right font-bold text-slate-700">{cVotes.toLocaleString()}</td>
                                 </tr>
                               );
                             })}
                           </tbody>
                         </table>
                      </div>
                   </div>

                </div>
             </div>
          )}
        </main>
      </div>
      
      {/* Upload Modal */}
      {showUploadModal && <FileUploadModal onUpload={handleCsvUpload} onClose={() => setShowUploadModal(false)} />}
      
      {/* Success Toast */}
      {showLoadSuccess && (
          <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center animate-in slide-in-from-bottom-10 fade-in duration-300 z-50">
              <CheckCircle2 className="w-5 h-5 mr-3" />
              <div>
                  <h4 className="font-bold text-sm">Carga Exitosa</h4>
                  <p className="text-xs opacity-90">
                      {data.loadReport.exact} exactos, {data.loadReport.approx} aproximados.
                  </p>
              </div>
          </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<DashboardApp />);
