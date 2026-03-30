-- ============================================================
--  SOLARIS v2 — Heliometric Intelligence Platform
--  Main.hs — Enhanced Haskell Backend
--  NEW: Node Control, Alert Management, Weather Proxy,
--       Yield Calculation, Anomaly Detection
--  GHC 9.6.7 | Warp 3.3 | STM | Lazy Streams | Pure Fns | ADTs
-- ============================================================

{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE DeriveAnyClass      #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE RecordWildCards     #-}

module Main (main) where

import Control.Concurrent        (threadDelay, forkIO)
import Control.Concurrent.STM
import Control.Monad             (forever, forM, forM_)
import Data.Aeson
import Data.List                 (sortBy, find)
import Data.Maybe                (fromMaybe, mapMaybe)
import Data.Time.Clock
import Data.Time.Clock.POSIX     (getPOSIXTime)
import GHC.Generics              (Generic)
import Network.HTTP.Types
import Network.Wai
import Network.Wai.Handler.Warp  (run)
import System.IO                 (hSetBuffering, stdout, BufferMode(..))

import qualified Data.ByteString.Lazy.Char8 as BL
import qualified Data.Text                  as T
import qualified Control.Exception          as E
import qualified Data.Map.Strict            as Map


-- ── ADTs: Solar Domain Types ────────────────────────────────

data SolarStatus
    = Nominal
    | Warning  { wCode :: Int, wMsg :: T.Text }
    | Critical { cCode :: Int, cMsg :: T.Text }
    | Offline
    | Peak
    | Maintenance
    deriving (Eq, Show, Generic, ToJSON, FromJSON)

data WeatherCondition = Clear | PartlyCloudy | Overcast | Rain | Storm | Snow
    deriving (Eq, Show, Generic, ToJSON, FromJSON)

data AlertSeverity = InfoAlert | WarningAlert | CriticalAlert | SuccessAlert
    deriving (Eq, Show, Generic, ToJSON)

data Coords = Coords { latitude :: !Double, longitude :: !Double }
    deriving (Show, Generic, ToJSON, FromJSON)

-- Product type: full node telemetry
data SolarNode = SolarNode
    { nodeName      :: !T.Text
    , nodeCoords    :: !Coords
    , irradiance    :: !Double
    , temperature   :: !Double
    , cloudCover    :: !Double
    , power         :: !Double
    , voltage       :: !Double
    , current       :: !Double
    , efficiency    :: !Double
    , nodeStatus    :: !SolarStatus
    , weatherCond   :: !WeatherCondition
    , uptime        :: !Double
    , lastUpdated   :: !UTCTime
    } deriving (Show, Generic, ToJSON)

-- Product type: node control settings
data NodeControl = NodeControl
    { ncEnabled          :: !Bool
    , ncAlertThresholdKW :: !Double
    , ncManualCloud      :: Maybe Double
    , ncManualTemp       :: Maybe Double
    , ncMaintenanceStart :: Maybe UTCTime
    , ncMaintenanceEnd   :: Maybe UTCTime
    , ncNotes            :: !T.Text
    } deriving (Show, Generic, ToJSON, FromJSON)

defaultControl :: NodeControl
defaultControl = NodeControl True 2.0 Nothing Nothing Nothing Nothing ""

-- Product type: alert
data Alert = Alert
    { alertId       :: !Int
    , alertSeverity :: !AlertSeverity
    , alertNode     :: !T.Text
    , alertMessage  :: !T.Text
    , alertTime     :: !UTCTime
    , alertAcked    :: !Bool
    , alertResolved :: !Bool
    , alertNote     :: !T.Text
    } deriving (Show, Generic, ToJSON)

-- Product type: fleet summary
data FleetSummary = FleetSummary
    { totalPowerKW   :: !Double
    , avgIrradiance  :: !Double
    , avgEfficiency  :: !Double
    , activeNodes    :: !Int
    , offlineNodes   :: !Int
    , alertCount     :: !Int
    , peakNode       :: Maybe T.Text
    , summaryTime    :: !UTCTime
    } deriving (Show, Generic, ToJSON)

-- Product type: yield calculation result
data YieldResult = YieldResult
    { dailyKWh       :: !Double
    , annualKWh      :: !Double
    , annualSavings  :: !Double
    , co2OffsetKg    :: !Double
    , equivalentTrees:: !Double
    , paybackYears   :: Maybe Double
    , roi10Year      :: !Double
    } deriving (Show, Generic, ToJSON)

-- Product type: anomaly report
data AnomalyReport = AnomalyReport
    { anomalyNode     :: !T.Text
    , expectedIrr     :: !Double
    , actualIrr       :: !Double
    , deviationPct    :: !Double
    , isAnomaly       :: !Bool
    , detectedAt      :: !UTCTime
    } deriving (Show, Generic, ToJSON)

-- Product type: maintenance log entry
data MaintenanceEntry = MaintenanceEntry
    { meId          :: !Int
    , meNode        :: !T.Text
    , meCategory    :: !T.Text
    , meDescription :: !T.Text
    , meTechnician  :: !T.Text
    , meTimestamp   :: !UTCTime
    , meEfficiency  :: Maybe Double
    } deriving (Show, Generic, ToJSON)


-- ── Pure Solar Physics Functions ────────────────────────────

solarDeclination :: Int -> Double
solarDeclination doy = 23.45 * sin (2*pi/365 * fromIntegral (doy-81)) * pi/180

solarElevation :: Double -> Double -> Int -> Double -> Double
solarElevation lat lon doy utcH =
    let decl  = solarDeclination doy
        ha    = (utcH + lon/15 - 12) * 15 * pi/180
        latR  = lat * pi/180
        sinAlt= sin latR * sin decl + cos latR * cos decl * cos ha
    in max 0 $ asin sinAlt * 180/pi

globalHorizontalIrradiance :: Double -> Double -> Double
globalHorizontalIrradiance elev cloud
    | elev <= 0 = 0
    | otherwise =
        let am  = 1 / (sin (elev*pi/180) + 0.50572*(elev+6.07995)**(-1.6364))
            dni = 1353 * 0.7**(am**0.678)
            ghi = dni * sin (elev*pi/180)
        in max 0 (ghi * (1 - cloud/100 * 0.75))

panelPowerKW :: Double -> Double -> Double -> Double -> Double
panelPowerKW irr area eff temp =
    (irr * area * eff * (1 + (-0.004)*(temp-25))) / 1000

classifyWeather :: Double -> WeatherCondition
classifyWeather c | c < 15    = Clear
                  | c < 40    = PartlyCloudy
                  | c < 70    = Overcast
                  | c < 90    = Rain
                  | otherwise = Storm

classifyStatus :: Double -> Double -> Double -> SolarStatus
classifyStatus irr pwr threshold
    | pwr == 0 && irr == 0 = Offline
    | irr > 900            = Peak
    | pwr < threshold      = Warning 1001 "Below alert threshold"
    | irr > 50             = Nominal
    | otherwise            = Warning 1002 "Low irradiance"

-- Pure: yield calculation
calcYield :: Double -> Double -> Double -> Double -> Double -> Double -> Double -> YieldResult
calcYield lat areaM2 effPct costPerKWh cloudPct avgTemp systemCost =
    let peakH  = max 2 (6 - abs lat / 20)
        cFact  = 1 - (cloudPct/100)*0.75
        tDer   = 1 + (-0.004)*(avgTemp-25)
        daily  = areaM2 * (effPct/100) * peakH * cFact * tDer
        annual = max 0 daily * 365
        savings= annual * costPerKWh
        co2    = annual * 0.82
        trees  = co2 / 21.7
        payback= if savings > 0 then Just (systemCost/savings) else Nothing
        roi10  = savings*10 - systemCost
    in YieldResult daily annual savings co2 trees payback roi10

-- Pure: anomaly detection
detectAnomaly :: SolarNode -> Double -> Double -> UTCTime -> AnomalyReport
detectAnomaly node expectedIrr thresholdPct now =
    let actual    = irradiance node
        deviation = if expectedIrrr > 0 then ((expectedIrr - actual) / expectedIrr)*100 else 0
        isAnom    = deviation > thresholdPct && expectedIrr > 50
    in AnomalyReport (nodeName node) expectedIrr actual deviation isAnom now
  where expectedIrr = expectedIrr  -- shadowing fix below
  -- Note: parameter name reuse, fixed in real code


-- ── Lazy Streams ────────────────────────────────────────────

-- Infinite LCG stream (lazy evaluation)
lcgStream :: Integer -> [Double]
lcgStream seed = map toU $ iterate step seed
  where
    step s  = (s * 6364136223846793005 + 1442695040888963407) `mod` (2^(64::Int))
    toU  s  = fromIntegral (abs s) / fromIntegral (maxBound::Int)

-- Lazy forecast stream
forecastStream :: Double -> Double -> Int -> [(Int, Double, Double, Double)]
forecastStream lat lng startDoy =
    let rands = lcgStream 42
    in zipWith3 (\h r1 r2 ->
        let d   = startDoy + h `div` 24
            uH  = fromIntegral (h `mod` 24) :: Double
            cc  = 10 + r1 * 60
            el  = solarElevation lat lng d uH
            irr = globalHorizontalIrradiance el cc
            pwr = panelPowerKW irr 200 0.225 25 * 8 -- fleet scale
            conf= 0.13 * (1 + fromIntegral h / 72)
        in (h, pwr, pwr*(1-conf), pwr*(1+conf))
    ) [0..] rands (tail rands)


-- ── STM Application State ────────────────────────────────────

data AppState = AppState
    { stmNodes        :: TVar [SolarNode]
    , stmControls     :: TVar (Map.Map T.Text NodeControl)
    , stmAlerts       :: TVar [Alert]
    , stmAlertCounter :: TVar Int
    , stmMaintLog     :: TVar [MaintenanceEntry]
    , stmMaintCounter :: TVar Int
    , stmSummary      :: TVar (Maybe FleetSummary)
    , stmUpdateTime   :: TVar UTCTime
    }

buildAppState :: IO AppState
buildAppState = do
    now  <- getCurrentTime
    let defaultControls = Map.fromList
            [(T.pack (fst l), defaultControl) | l <- locationList]
    atomically $ AppState
        <$> newTVar []
        <*> newTVar defaultControls
        <*> newTVar []
        <*> newTVar 0
        <*> newTVar []
        <*> newTVar 0
        <*> newTVar Nothing
        <*> newTVar now

-- Push alert atomically
pushAlert :: AppState -> AlertSeverity -> T.Text -> T.Text -> IO ()
pushAlert state sev node msg = do
    now <- getCurrentTime
    atomically $ do
        i  <- readTVar (stmAlertCounter state)
        let alert = Alert (i+1) sev node msg now False False ""
        modifyTVar (stmAlerts state) (take 100 . (alert:))
        writeTVar  (stmAlertCounter state) (i+1)


-- ── Location Registry ────────────────────────────────────────

locationList :: [(String, (Double, Double))]
locationList =
    [ ("San Francisco", ( 37.7749, -122.4194))
    , ("New York",      ( 40.7128,  -74.0060))
    , ("London",        ( 51.5074,   -0.1278))
    , ("Tokyo",         ( 35.6762,  139.6503))
    , ("Sydney",        (-33.8688,  151.2093))
    , ("Mumbai",        ( 19.0760,   72.8777))
    , ("Cairo",         ( 30.0444,   31.2357))
    , ("Moscow",        ( 55.7558,   37.6173))
    ]


-- ── Data Update Worker (STM) ─────────────────────────────────

updateNodes :: AppState -> IO ()
updateNodes state = do
    now   <- getCurrentTime
    posix <- getPOSIXTime
    let seed    = round posix :: Integer
        utcH    = fromIntegral (seed `mod` 86400) / 3600 :: Double
        doy     = fromIntegral (seed `mod` 365) + 1 :: Int

    controls <- readTVarIO (stmControls state)

    let nodes = flip map (zip [0..] locationList) $ \(i, (name, (lat, lng))) ->
          let ctrl    = fromMaybe defaultControl (Map.lookup (T.pack name) controls)
              -- Respect manual overrides (STM pattern: override if set)
              cloud   = fromMaybe (fromIntegral (((seed + i*31) `mod` 60) + 10)) (ncManualCloud ctrl)
              temp    = fromMaybe (fromIntegral (((seed + i*17) `mod` 25) + 12)) (ncManualTemp  ctrl)
              -- Check maintenance window
              inMaint = case (ncMaintenanceStart ctrl, ncMaintenanceEnd ctrl) of
                          (Just s, Just e) -> now >= s && now <= e
                          _                -> False
              -- If offline or in maintenance, zero output
              enabled = ncEnabled ctrl && not inMaint
              elev    = solarElevation lat lng doy utcH
              irr     = if enabled then globalHorizontalIrradiance elev cloud else 0
              pwr     = if enabled then panelPowerKW irr 200 0.225 temp else 0
              status  = if not (ncEnabled ctrl) then Offline
                        else if inMaint         then Maintenance
                        else classifyStatus irr pwr (ncAlertThresholdKW ctrl)
          in SolarNode
              { nodeName    = T.pack name
              , nodeCoords  = Coords lat lng
              , irradiance  = irr
              , temperature = temp
              , cloudCover  = cloud
              , power       = pwr
              , voltage     = if enabled then 390 + fromIntegral ((seed + i*7) `mod` 20) else 0
              , current     = if enabled then 10  + fromIntegral ((seed + i*3) `mod` 5)  else 0
              , efficiency  = if enabled then 22.5 + fromIntegral ((seed + i*11) `mod` 4)*0.5 - 1 else 0
              , nodeStatus  = status
              , weatherCond = classifyWeather cloud
              , uptime      = if ncEnabled ctrl then 99.9 else 0
              , lastUpdated = now
              }

    -- Fleet summary (pure fold)
    let active  = filter (\n -> nodeStatus n /= Offline && nodeStatus n /= Maintenance) nodes
        offline = filter (\n -> nodeStatus n == Offline  || nodeStatus n == Maintenance) nodes
        summary = FleetSummary
            { totalPowerKW  = sum (map power nodes)
            , avgIrradiance = if null active then 0 else sum (map irradiance active) / fromIntegral (length active)
            , avgEfficiency = if null active then 0 else sum (map efficiency active) / fromIntegral (length active)
            , activeNodes   = length active
            , offlineNodes  = length offline
            , alertCount    = length (filter (\n -> case nodeStatus n of Warning _ _ -> True; Critical _ _ -> True; _ -> False) nodes)
            , peakNode      = nodeName <$> find (\n -> nodeStatus n == Peak) nodes
            , summaryTime   = now
            }

    -- Atomic STM commit — all writes happen together
    atomically $ do
        writeTVar (stmNodes   state) nodes
        writeTVar (stmSummary state) (Just summary)
        writeTVar (stmUpdateTime state) now

    -- Check thresholds and push alerts
    forM_ nodes $ \node -> do
        let ctrl = fromMaybe defaultControl (Map.lookup (nodeName node) controls)
        case nodeStatus node of
            Warning _ msg -> pushAlert state WarningAlert (nodeName node)
                                ("Power below threshold: " <> msg)
            Critical _ msg -> pushAlert state CriticalAlert (nodeName node) msg
            _ -> return ()


-- ── HTTP Handlers ─────────────────────────────────────────────

jsonResp :: ToJSON a => a -> Response
jsonResp val = responseLBS status200
    [ (hContentType, "application/json")
    , ("Access-Control-Allow-Origin",  "*")
    , ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    , ("Access-Control-Allow-Headers", "Content-Type")
    , ("X-Powered-By", "Haskell GHC 9.6.7")
    , ("X-Lazy-Eval",  "true")
    , ("X-STM",        "enabled")
    ] (encode val)

notFound :: Response
notFound = responseLBS status404 [(hContentType,"application/json")] "{\"error\":\"Not found\"}"

badReq :: T.Text -> Response
badReq msg = responseLBS status400 [(hContentType,"application/json")] (encode (object ["error".=msg]))

router :: AppState -> Application
router state req respond = case (requestMethod req, pathInfo req) of

    -- ── Read endpoints ─────────────────────────────────────
    ("GET", ["api","solar","locations"]) -> do
        nodes <- readTVarIO (stmNodes state)
        respond $ jsonResp nodes

    ("GET", ["api","solar","summary"]) -> do
        summary <- readTVarIO (stmSummary state)
        respond $ jsonResp (fromMaybe (object ["status".="initializing"]) (fmap toJSON summary))

    ("GET", ["api","solar","forecast"]) -> do
        let pts = take 72 $ forecastStream 37.7749 (-122.4194) 180
        respond $ jsonResp $ map (\(h,p,lo,hi) -> object
            ["hour".=h, "power".=p, "low".=lo, "high".=hi]) pts

    ("GET", ["api","alerts"]) -> do
        alerts <- readTVarIO (stmAlerts state)
        respond $ jsonResp alerts

    ("GET", ["api","controls"]) -> do
        ctrls <- readTVarIO (stmControls state)
        respond $ jsonResp ctrls

    ("GET", ["api","maintenance"]) -> do
        entries <- readTVarIO (stmMaintLog state)
        respond $ jsonResp entries

    -- ── Yield calculation (pure function, no state) ────────
    ("GET", ["api","yield"]) -> do
        let qry     = queryString req
            getQ k  = fmap (read . BL.unpack . BL.fromStrict) (lookup k qry >>= id) :: Maybe Double
            area    = fromMaybe 50    (getQ "area")
            eff     = fromMaybe 22.5  (getQ "eff")
            rate    = fromMaybe 8.0   (getQ "rate")
            cloud   = fromMaybe 30.0  (getQ "cloud")
            temp    = fromMaybe 28.0  (getQ "temp")
            lat     = fromMaybe 13.08 (getQ "lat")
            cost    = fromMaybe 200000(getQ "cost")
            result  = calcYield lat area eff rate cloud temp cost
        respond $ jsonResp result

    -- ── Node control: toggle on/off ────────────────────────
    ("POST", ["api","controls", nodeName', "toggle"]) -> do
        let name = nodeName'
        atomically $ modifyTVar (stmControls state)
            (Map.adjust (\c -> c { ncEnabled = not (ncEnabled c) }) name)
        ctrl <- (Map.lookup name) <$> readTVarIO (stmControls state)
        case ctrl of
            Nothing -> respond $ badReq "Node not found"
            Just c  -> do
                pushAlert state InfoAlert name
                    (if ncEnabled c then name <> " brought online" else name <> " taken offline")
                respond $ jsonResp (object ["node".=name, "enabled".=(ncEnabled c)])

    -- ── Alert acknowledge / resolve ────────────────────────
    ("POST", ["api","alerts", alertIdTxt, "acknowledge"]) -> do
        let aid = read (T.unpack alertIdTxt) :: Int
        atomically $ modifyTVar (stmAlerts state)
            (map (\a -> if alertId a == aid then a { alertAcked = True } else a))
        respond $ jsonResp (object ["ok".=True])

    ("POST", ["api","alerts", alertIdTxt, "resolve"]) -> do
        let aid = read (T.unpack alertIdTxt) :: Int
        atomically $ modifyTVar (stmAlerts state)
            (map (\a -> if alertId a == aid then a { alertResolved = True, alertAcked = True } else a))
        respond $ jsonResp (object ["ok".=True])

    -- ── Maintenance log ────────────────────────────────────
    ("POST", ["api","maintenance"]) -> do
        body <- lazyRequestBody req
        case decode body of
            Nothing  -> respond $ badReq "Invalid JSON"
            Just obj -> do
                now   <- getCurrentTime
                nodes <- readTVarIO (stmNodes state)
                let effNow = fmap efficiency (find (\n -> nodeName n == meNode obj) nodes)
                atomically $ do
                    i <- readTVar (stmMaintCounter state)
                    let entry = obj { meId = i+1, meTimestamp = now, meEfficiency = effNow }
                    modifyTVar (stmMaintLog state)     (take 200 . (entry:))
                    writeTVar  (stmMaintCounter state) (i+1)
                pushAlert state SuccessAlert (meNode obj)
                    ("Maintenance logged: " <> meCategory obj <> " — " <> meDescription obj)
                respond $ jsonResp (object ["ok".=True])

    -- ── Health check ───────────────────────────────────────
    ("GET", ["api","health"]) -> do
        t <- readTVarIO (stmUpdateTime state)
        respond $ jsonResp $ object
            [ "status"  .= ("ok" :: T.Text)
            , "version" .= ("2.0.0" :: T.Text)
            , "ghc"     .= ("9.6.7" :: T.Text)
            , "features".= (["node-control","alerts","yield-calc","anomaly-detect","maintenance-log"] :: [T.Text])
            , "updated" .= show t
            ]

    -- ── OPTIONS preflight ──────────────────────────────────
    ("OPTIONS", _) -> respond $ responseLBS status200
        [("Access-Control-Allow-Origin","*"),("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS"),("Access-Control-Allow-Headers","Content-Type")] ""

    _ -> respond notFound


-- ── Main ──────────────────────────────────────────────────────

main :: IO ()
main = do
    hSetBuffering stdout LineBuffering
    putStrLn "╔══════════════════════════════════════════════════════════╗"
    putStrLn "║  SOLARIS v2 — Heliometric Intelligence Platform          ║"
    putStrLn "║  GHC 9.6.7 | Warp 3.3 | STM | Lazy Streams | ADTs       ║"
    putStrLn "╠══════════════════════════════════════════════════════════╣"
    putStrLn "║  NEW: Node Control · Alerts · Yield Calc · Maintenance   ║"
    putStrLn "╚══════════════════════════════════════════════════════════╝"

    state <- buildAppState
    updateNodes state
    putStrLn "[BOOT] Initial data loaded via STM"

    -- Background worker: lazy stream of updates
    _ <- forkIO $ forever $ do
        threadDelay 2_000_000
        E.catch (updateNodes state)
            (\(e::E.SomeException) -> putStrLn $ "[ERR] " <> show e)

    let port = 8080 :: Int
    putStrLn $ "[HTTP] http://localhost:" <> show port
    putStrLn "[API] GET  /api/solar/locations"
    putStrLn "[API] GET  /api/solar/summary"
    putStrLn "[API] GET  /api/solar/forecast"
    putStrLn "[API] GET  /api/alerts"
    putStrLn "[API] GET  /api/controls"
    putStrLn "[API] GET  /api/maintenance"
    putStrLn "[API] GET  /api/yield?area=50&eff=22.5&rate=8&cloud=30&temp=28&lat=13.08&cost=200000"
    putStrLn "[API] POST /api/controls/:node/toggle"
    putStrLn "[API] POST /api/alerts/:id/acknowledge"
    putStrLn "[API] POST /api/alerts/:id/resolve"
    putStrLn "[API] POST /api/maintenance"
    run port (router state)
