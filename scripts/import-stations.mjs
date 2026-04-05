import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hugbfiogyymttvtvmymy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Z2JmaW9neXltdHR2dHZteW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDIwNDQsImV4cCI6MjA5MDk3ODA0NH0.ijV29upowfGwARinsMsT-JOqCF9ZVAJ-tOjKufGx8kM'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function fetchStationsFromOSM() {
    console.log('Fetching via Overpass mirror...')
  
    const query = `
      [out:json][timeout:25];
      node["amenity"="fuel"](20.59,88.01,26.63,92.67);
      out;
    `
  
    const endpoints = [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.openstreetmap.fr/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ]
  
    for (const url of endpoints) {
      try {
        console.log(`Trying: ${url}`)
  
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
  
        if (!res.ok) continue
  
        const data = await res.json()
        console.log(`✅ Success from ${url}: ${data.elements.length} stations`)
        return data.elements
  
      } catch (err) {
        console.log(`❌ Failed: ${url}`)
      }
    }
  
    throw new Error('All Overpass endpoints failed')
  }

function parseStation(element) {
  const tags = element.tags || {}

  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (!lat || !lng) return null

  const fuelTypes = []
  if (tags['fuel:octane_95'] === 'yes' || tags['fuel:octane_91'] === 'yes') fuelTypes.push('Octane')
  if (tags['fuel:diesel'] === 'yes' || tags['fuel:HGV_diesel'] === 'yes') fuelTypes.push('Diesel')
  if (tags['fuel:cng'] === 'yes') fuelTypes.push('CNG')
  if (tags['fuel:lpg'] === 'yes') fuelTypes.push('LPG')
  if (fuelTypes.length === 0) fuelTypes.push('Octane', 'Diesel')

  const name = tags['name:en'] || tags.name || tags['name:bn'] || 'Fuel Station'
  const address = [
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city']
  ].filter(Boolean).join(', ') || tags['addr:full'] || ''

  const district = tags['addr:city'] || tags['addr:district'] || 'Bangladesh'
  const brand = tags.brand || tags.operator || ''
  const fullName = brand && !name.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} - ${name}`
    : name

  return {
    name: fullName.substring(0, 100),
    address: address.substring(0, 200),
    district: district.substring(0, 100),
    lat: parseFloat(lat.toFixed(6)),
    lng: parseFloat(lng.toFixed(6)),
    fuel_types: fuelTypes,
    daily_capacity: 30,
    is_active: true,
    osm_id: String(element.id)
  }
}

async function insertStations(stations) {
  console.log(`\nInserting ${stations.length} stations into Supabase...`)
  let inserted = 0
  let failed = 0
  const batchSize = 50

  for (let i = 0; i < stations.length; i += batchSize) {
    const batch = stations.slice(i, i + batchSize)
    const { error } = await supabase
      .from('fuel_stations')
      .upsert(batch, { onConflict: 'osm_id', ignoreDuplicates: true })

    if (error) {
      console.error(`Batch error:`, error.message)
      failed += batch.length
    } else {
      inserted += batch.length
      process.stdout.write(`\r  Inserted ${inserted} / ${stations.length}...`)
    }

    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n  Done — inserted: ${inserted}, failed: ${failed}`)
  return inserted
}

async function generateSlots(totalStations) {
  console.log('\nGenerating time slots...')

  const { data: stations } = await supabase
    .from('fuel_stations')
    .select('id')
    .eq('is_active', true)

  if (!stations?.length) {
    console.log('No stations found.')
    return
  }

  const slotTimes = [
    ['08:00','08:30'],['08:30','09:00'],
    ['09:00','09:30'],['09:30','10:00'],
    ['10:00','10:30'],['10:30','11:00'],
    ['11:00','11:30'],['11:30','12:00'],
    ['14:00','14:30'],['14:30','15:00'],
    ['15:00','15:30'],['15:30','16:00'],
  ]

  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dates = [today, tomorrow]

  const slots = []
  for (const station of stations) {
    for (const date of dates) {
      for (const [start, end] of slotTimes) {
        slots.push({
          station_id: station.id,
          slot_date: date,
          start_time: start,
          end_time: end,
          capacity: 5,
          booked_count: 0
        })
      }
    }
  }

  console.log(`  Inserting ${slots.length} slots for ${stations.length} stations...`)

  const batchSize = 500
  for (let i = 0; i < slots.length; i += batchSize) {
    const { error } = await supabase
      .from('time_slots')
      .upsert(slots.slice(i, i + batchSize), { ignoreDuplicates: true })
    if (error) console.error('Slot error:', error.message)
    else process.stdout.write(`\r  Slots inserted: ${Math.min(i + batchSize, slots.length)} / ${slots.length}`)
    await new Promise(r => setTimeout(r, 200))
  }

  console.log('\n  Slots done!')
}

async function main() {
  console.log('=== FuelToken BD — Station Importer ===\n')

  try {
    const elements = await fetchStationsFromOSM()

    if (elements.length === 0) {
      console.log('No stations returned. Check your internet connection or try again in a few minutes.')
      return
    }

    const stations = elements.map(parseStation).filter(Boolean)
    console.log(`Parsed ${stations.length} valid stations with coordinates`)

    const inserted = await insertStations(stations)
    await generateSlots(inserted)

    console.log('\n✓ All done! Refresh your app to see real Bangladesh fuel stations on the map.')

  } catch (err) {
    console.error('\nError:', err.message)
    process.exit(1)
  }
}

main()