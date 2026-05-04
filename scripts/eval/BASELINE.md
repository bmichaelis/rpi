# Baseline — current production formula

`rating = 0.0810 + 0.1383*(W-L) + 0.9152*strength + 1.3587*gdCap + 11.1414*(W-L)/nGames`

Captured: 2026-05-04T23:00:53.566Z

(Previous formula: `0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap + 0.0552` — Utah MAE 0.93, Texas MAE 4.39, Texas R² −0.62. Replaced 2026-05-04 by the residual reverse-engineering experiment.)

## Training set: utah-2026

- n: 77
- MAE: 0.7278
- RMSE: 0.8848
- MaxErr: 2.0907
- R²: 0.9895

By class:
- 4A: n=29, MAE=0.7377, MaxErr=1.5265
- 5A: n=30, MAE=0.9708, MaxErr=2.0907
- 6A: n=18, MAE=0.3068, MaxErr=1.2465

Worst 10:
| slug | predicted | official | residual |
|------|-----------|----------|----------|
| ut/west-jordan/west-jordan-jaguars | -12.4293 | -14.5200 | 2.0907 |
| ut/sandy/alta-hawks | 17.2144 | 19.1900 | -1.9756 |
| ut/clearfield/clearfield-falcons | -6.4394 | -8.0300 | 1.5906 |
| ut/park-city/park-city-miners | 6.6765 | 5.1500 | 1.5265 |
| ut/hyrum/mountain-crest-mustangs | 5.3368 | 6.8100 | -1.4732 |
| ut/salt-lake-city/west-panthers | -6.6685 | -8.1400 | 1.4715 |
| ut/salt-lake-city/highland-rams | -0.2581 | -1.7000 | 1.4419 |
| ut/smithfield/sky-view-bobcats | 7.7601 | 9.1600 | -1.3999 |
| ut/midvale/hillcrest-huskies | 3.8782 | 5.2300 | -1.3518 |
| ut/salt-lake-city/brighton-bengals | 6.6208 | 7.9700 | -1.3492 |

## Held-out set: texas-2026

- n: 100
- MAE: 1.5980
- RMSE: 2.4666
- MaxErr: 8.1350
- R²: 0.6176

By class:
- 4A: n=9, MAE=2.1870, MaxErr=7.2749
- 5A: n=26, MAE=1.4758, MaxErr=7.2915
- 6A: n=54, MAE=1.2792, MaxErr=7.9695
- OOS: n=11, MAE=2.9706, MaxErr=8.1350

Worst 10:
| slug | predicted | official | residual |
|------|-----------|----------|----------|
| tx/bellaire/episcopal-knights | 19.4150 | 27.5500 | -8.1350 |
| tx/the-woodlands/college-park-cavaliers | 23.1605 | 31.1300 | -7.9695 |
| tx/dallas/adams-cougars | 11.6685 | 18.9600 | -7.2915 |
| tx/bridgeport/bridgeport-bulls | 16.2651 | 23.5400 | -7.2749 |
| tx/san-antonio/pieper-warriors | 20.1970 | 26.5200 | -6.3230 |
| tx/irving/cistercian-hawks | 12.6317 | 18.9300 | -6.2983 |
| tx/houston/klein-cain-hurricanes | 21.3319 | 27.6300 | -6.2981 |
| tx/waco/la-vega-pirates | 16.8203 | 22.5400 | -5.7197 |
| tx/san-antonio/san-antonio-christian-lions | 15.5615 | 20.6600 | -5.0985 |
| tx/prosper/walnut-grove-wildcats | 26.5712 | 31.3300 | -4.7588 |

## Acceptance bar for new approaches

A new formula must beat this baseline by **≥ 0.20 MAE on the texas-2026 held-out set**.
Current bar: MAE < 1.3980.
