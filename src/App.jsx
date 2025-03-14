import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'

import './App.css'

const CLIENT_ID = '346cf080-d6d3-4094-8f3b-01a651b91f92'
const AUTH_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize'
const TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token'
const FHIR_BASE_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'
const REDIRECT_URI = 'http://localhost:3000'
const SCOPE = 'openid fhirUser'

const CODE_CHALLENGE_METHOD = 'S256'

function App () {
  const [accessToken, setAccessToken] = useState(null)
  const [patientData, setPatientData] = useState(null)
  const [patientId, setPatientId] = useState(null)
  const [activeSection, setActiveSection] = useState(null)
  const [medications, setMedications] = useState([])
  const [labReports, setLabReports] = useState([])
  const [vitalSigns, setVitalSigns] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const recordsPerPage = 5

  const generateRandomString = length => {
    const possible =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
    return Array.from(crypto.getRandomValues(new Uint8Array(length)))
      .map(x => possible[x % possible.length])
      .join('')
  }

  const sha256 = async plain => {
    const encoder = new TextEncoder()
    const data = encoder.encode(plain)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  const handleLogin = async () => {
    localStorage.clear()

    const codeVerifier = generateRandomString(128)
    console.log('Generated Code Verifier (Before Login):', codeVerifier)
    localStorage.setItem('pkce_code_verifier', codeVerifier)

    const codeChallenge = await sha256(codeVerifier)
    console.log('Generated Code Challenge:', codeChallenge)

    const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent(
      SCOPE
    )}&code_challenge=${codeChallenge}&code_challenge_method=${CODE_CHALLENGE_METHOD}`

    window.location.href = authUrl
  }

  const fetchAccessToken = async code => {
    window.history.replaceState({}, document.title, window.location.pathname)

    const codeVerifier = localStorage.getItem('pkce_code_verifier')

    if (!codeVerifier) {
      console.error(
        "Missing 'code_verifier' from Local Storage. Cannot request token."
      )
      return
    }

    // console.log('Authorization Code:', code)
    // console.log('Stored Code Verifier (Before Token Request):', codeVerifier)

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier
    })

    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      })

      const data = await response.json()
      console.log('🔵 Response from Token API:', data)

      if (data.access_token) {
        console.log('✅ Storing Access Token:', data.access_token)
        localStorage.setItem('access_token', data.access_token)
        setAccessToken(data.access_token)

        console.log('🔵 data.patient:', data.patient)
        let extractedPatientId = data.patient || null

        if (extractedPatientId) {
          setPatientId(extractedPatientId)
          console.log('✅ Extracted Patient ID:', extractedPatientId)
          localStorage.setItem('patient_id', extractedPatientId)
        } else {
          console.error('Patient ID not found in token response.')
        }

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        )
      } else {
        console.error('Token request failed:', data)
      }
    } catch (error) {
      console.error('Error fetching access token:', error)
    }
  }

  const fetchPatientData = async (token, patientId) => {
    if (!token || !patientId) {
      console.error('Missing access token or patient ID.')
      return
    }

    console.log(`Fetching patient data for ID: ${patientId}`)

    try {
      const response = await fetch(`${FHIR_BASE_URL}/Patient/${patientId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      })

      if (response.status === 401) {
        console.error('Unauthorized: Token may be expired or missing scope.')
        return
      }

      if (!response.ok) {
        console.error(`Error fetching patient data: ${response.statusText}`)
        return
      }

      const data = await response.json()
      console.log('✅ Patient Data:', data)

      const patientInfo = {
        name:
          data.name?.[0]?.text ||
          `${data.name?.[0]?.given?.join(' ')} ${data.name?.[0]?.family}`,
        gender: data.gender,
        dob: data.birthDate,
        identifier: data.identifier?.[1]?.value || 'N/A'
      }

      setPatientData(patientInfo)
      localStorage.setItem('patient_data', JSON.stringify(patientInfo))
    } catch (error) {
      console.error('Error fetching patient data:', error)
    }
  }

  const handleLogout = () => {
    console.log('✅ Logging out and clearing session...')
    localStorage.clear()
    setAccessToken(null)
    setPatientData(null)
    setPatientId(null)
    window.location.href = REDIRECT_URI
  }

  const fetchMedications = async (token, patientId) => {
    try {
      const response = await fetch(
        `${FHIR_BASE_URL}/MedicationRequest?patient=${patientId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          }
        }
      )

      if (!response.ok) {
        console.error(`Error fetching medications: ${response.statusText}`)
        return
      }

      const data = await response.json()
      console.log('✅ Medications:', data)
      setMedications(data.entry || [])
    } catch (error) {
      console.error('Error fetching medications:', error)
    }
  }

  const fetchLabReports = async (token, patientId) => {
    try {
      const response = await fetch(
        `${FHIR_BASE_URL}/DiagnosticReport?patient=${patientId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          }
        }
      )

      if (!response.ok) {
        console.error(`Error fetching lab reports: ${response.statusText}`)
        return
      }

      const data = await response.json()
      console.log('Lab Reports:', data)
      setLabReports(data.entry || [])
    } catch (error) {
      console.error('Error fetching lab reports:', error)
    }
  }

  const fetchVitalSigns = async (token, patientId) => {
    try {
      const response = await fetch(
        `${FHIR_BASE_URL}/Observation?patient=${patientId}&category=vital-signs`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          }
        }
      )

      if (!response.ok) {
        console.error(`Error fetching vital signs: ${response.statusText}`)
        return
      }

      const data = await response.json()
      console.log('Vital Signs:', data)
      const sortedVitalSigns = data.entry
        ? data.entry.sort(
            (a, b) =>
              new Date(b.resource?.effectiveDateTime || 0) -
              new Date(a.resource?.effectiveDateTime || 0)
          )
        : []

      console.log('✅ Sorted Vital Signs:', sortedVitalSigns)
      setVitalSigns(sortedVitalSigns)
    } catch (error) {
      console.error('Error fetching vital signs:', error)
    }
  }

  const handleCardClick = section => {
    if (activeSection === section) {
      setActiveSection(null)
    } else {
      setActiveSection(section)
      if (section === 'medications') {
        console.log('Fetching medications for patient:', patientId)
        setMedications(null)
        fetchMedications(accessToken, patientId)
      } else if (section === 'labReports') {
        console.log('Fetching lab reports for patient:', patientId)
        setLabReports(null)
        fetchLabReports(accessToken, patientId)
      } else if (section === 'vitalSigns') {
        console.log('Fetching vital signs for patient:', patientId)
        setVitalSigns(null)
        fetchVitalSigns(accessToken, patientId)
      }
    }
  }

  const totalVitalSigns = Array.isArray(vitalSigns) ? vitalSigns.length : 0
  const totalPages = Math.ceil(totalVitalSigns / recordsPerPage)
  // console.log('----------------------------------')
  const indexOfLastRecord = currentPage * recordsPerPage
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage
  const currentVitalSigns = Array.isArray(vitalSigns)
    ? vitalSigns.slice(indexOfFirstRecord, indexOfLastRecord)
    : []

  const handlePageChange = direction => {
    if (direction === 'next' && indexOfLastRecord < vitalSigns?.length) {
      setCurrentPage(currentPage + 1)
    } else if (direction === 'prev' && currentPage > 1) {
      setCurrentPage(currentPage - 1)
    }
  }

  useEffect(() => {
    if (accessToken && patientId) {
      console.log('🔄 Patient ID updated. Fetching patient data...')
      fetchPatientData(accessToken, patientId)
    }
  }, [patientId])

  useEffect(() => {
    const storedAccessToken = localStorage.getItem('access_token')
    const storedPatientId = localStorage.getItem('patient_id')
    const storedPatientData = localStorage.getItem('patient_data')

    if (storedAccessToken) {
      setAccessToken(storedAccessToken)
    }

    if (storedPatientId) {
      setPatientId(storedPatientId)
    }

    if (storedPatientData) {
      setPatientData(JSON.parse(storedPatientData))
    }

    if (storedAccessToken && storedPatientId && !storedPatientData) {
      console.log('Fetching patient data again after refresh...')
      fetchPatientData(storedAccessToken, storedPatientId)
    }

    if (!storedAccessToken) {
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      if (code) {
        fetchAccessToken(code)
      }
    }
  }, [])

  return (
    <div className='App'>
      <header className='App-header'>
        <h1>Epic Patient App</h1>

        {!accessToken ? (
          <button onClick={handleLogin} className='login-button'>
            Sign in with Epic
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                // localStorage.clear()
                // setAccessToken(null)
                handleLogout()
              }}
              className='logout-button'
            >
              Sign Out
            </button>
            {!activeSection && patientData && (
              <div>
                <h2>Patient Details</h2>
                <p>
                  <strong>Name:</strong> {patientData.name}
                </p>
                <p>
                  <strong>Gender:</strong> {patientData.gender}
                </p>
                <p>
                  <strong>Date of Birth:</strong> {patientData.dob}
                </p>
                <p>
                  <strong>Identifier:</strong> {patientData.identifier}
                </p>
              </div>
            )}

            <div className='cards-container'>
              <div
                className={`card ${
                  activeSection === 'medications' ? 'active' : ''
                }`}
                onClick={() => handleCardClick('medications')}
              >
                <h3>Medications</h3>
              </div>
              <div
                className={`card ${
                  activeSection === 'labReports' ? 'active' : ''
                }`}
                onClick={() => handleCardClick('labReports')}
              >
                <h3>Lab Reports</h3>
              </div>
              <div
                className={`card ${
                  activeSection === 'vitalSigns' ? 'active' : ''
                }`}
                onClick={() => handleCardClick('vitalSigns')}
              >
                <h3>Vital Signs</h3>
              </div>
            </div>
            {activeSection === 'medications' && (
              <div className='section-list'>
                <h2>Medications</h2>
                <ul>
                  {medications === null ? (
                    <p>Loading medications...</p>
                  ) : medications.length > 0 ? (
                    medications
                      .filter(
                        med =>
                          med.resource?.resourceType === 'MedicationRequest'
                      )
                      .map((med, index) => (
                        <li key={index}>
                          <strong>Medication:</strong>{' '}
                          {med.resource?.medicationReference?.display ||
                            'Unknown Medication'}
                          <br />
                          <strong>Dosage:</strong>{' '}
                          {med.resource?.dosageInstruction?.[0]?.text ||
                            'No Dosage Info'}
                          <br />
                          <strong>Reason:</strong>{' '}
                          {med.resource?.reasonCode?.[0]?.text ||
                            'No Reason Provided'}
                        </li>
                      ))
                  ) : (
                    <p>No medications found.</p>
                  )}
                </ul>
              </div>
            )}
            {activeSection === 'labReports' && (
              <div className='section-list'>
                <h2>Lab Reports</h2>
                <ul>
                  {labReports === null ? (
                    <p>Loading lab reports...</p>
                  ) : labReports.length > 0 ? (
                    labReports
                      .filter(
                        report =>
                          report.resource?.resourceType === 'DiagnosticReport'
                      )
                      .map((report, index) => (
                        <li key={index}>
                          <strong>Test:</strong>{' '}
                          {report.resource?.code?.text || 'Unknown Test'} <br />
                          <strong>Status:</strong>{' '}
                          {report.resource?.status || 'Unknown Status'} <br />
                          <strong>Issued:</strong>{' '}
                          {/* {report.resource?.issued || 'Not Available'} <br /> */}
                          {report.resource?.issued
                            ? format(
                                new Date(report.resource.issued),
                                'dd MMM yyyy, hh:mm a'
                              )
                            : 'Unknown'}
                          <br />
                          <strong>Result:</strong>{' '}
                          {report.resource?.result
                            ?.map(r => r.display)
                            .join(', ') || 'No Results'}
                        </li>
                      ))
                  ) : (
                    <p>No Lab reports found.</p>
                  )}
                </ul>
              </div>
            )}
            {activeSection === 'vitalSigns' && (
              <div className='section-list'>
                <h2>Vital Signs</h2>
                <ul>
                  {currentVitalSigns.length === 0 ? (
                    <p> Loading...</p>
                  ) : currentVitalSigns.length > 0 ? (
                    currentVitalSigns
                      .filter(
                        vital => vital.resource?.resourceType === 'Observation'
                      )
                      .map((vital, index) => (
                        <li key={index}>
                          <strong>Type:</strong>{' '}
                          {vital.resource?.code?.text || 'Unknown'} <br />
                          <strong>Value:</strong>{' '}
                          {vital.resource?.valueQuantity?.value
                            ? `${vital.resource?.valueQuantity?.value} ${vital.resource?.valueQuantity?.unit}`
                            : 'No Value Recorded'}{' '}
                          <br />
                          <strong>Date:</strong>{' '}
                          {vital.resource?.effectiveDateTime
                            ? format(
                                new Date(vital.resource.effectiveDateTime),
                                'dd MMM yyyy, hh:mm a'
                              )
                            : 'Unknown'}
                          {vital.resource?.component?.length > 0 && (
                            <ul>
                              {vital.resource.component.map(
                                (comp, compIndex) => (
                                  <li key={compIndex}>
                                    <strong>
                                      {comp.code?.text || 'Unknown Component'}:
                                    </strong>{' '}
                                    {comp.valueQuantity?.value
                                      ? `${comp.valueQuantity?.value} ${comp.valueQuantity?.unit}`
                                      : 'No Value'}
                                  </li>
                                )
                              )}
                            </ul>
                          )}
                        </li>
                      ))
                  ) : (
                    <p>No vitalSigns found.</p>
                  )}
                </ul>

                <div className='pagination-controls'>
                  <button
                    onClick={() => handlePageChange('prev')}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <span>
                    {' '}
                    Page {currentPage} of {totalPages > 0 ? totalPages : 1}{' '}
                  </span>
                  <button
                    onClick={() => handlePageChange('next')}
                    disabled={indexOfLastRecord >= totalVitalSigns}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </header>
    </div>
  )
}

export default App
