# Baseline — current OLS formula

`rating = 0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap + 0.0552`

Captured: 2026-04-29T21:36:07.694Z

## Training set: utah-2026

- n: 77
- MAE: 0.9293
- RMSE: 1.0430
- MaxErr: 2.6675
- R²: 0.9855

By class:
- 4A: n=29, MAE=0.9886, MaxErr=2.6675
- 5A: n=30, MAE=1.0945, MaxErr=2.0982
- 6A: n=18, MAE=0.5584, MaxErr=1.4659

Worst 10:
| slug | predicted | official | residual |
|------|-----------|----------|----------|
| ut/hurricane/hurricane-tigers | -11.5775 | -8.9100 | -2.6675 |
| ut/clearfield/clearfield-falcons | -5.9318 | -8.0300 | 2.0982 |
| ut/sandy/alta-hawks | 17.1145 | 19.1900 | -2.0755 |
| ut/lehi/lehi-pioneers | -6.6259 | -5.1600 | -1.4659 |
| ut/park-city/park-city-miners | 6.6049 | 5.1500 | 1.4549 |
| ut/hyrum/mountain-crest-mustangs | 5.3893 | 6.8100 | -1.4207 |
| ut/roy/roy-royals | -11.0186 | -9.6500 | -1.3686 |
| ut/spanish-fork/spanish-fork-dons | -2.6822 | -1.3200 | -1.3622 |
| ut/washington/crimson-cliffs-mustangs | 9.6937 | 8.3500 | 1.3437 |
| ut/springville/springville-red-devils | -9.0201 | -7.6800 | -1.3401 |

## Held-out set: texas-2026

- n: 100
- MAE: 4.3937
- RMSE: 5.0755
- MaxErr: 17.3553
- R²: -0.6192

By class:
- 4A: n=9, MAE=5.3694, MaxErr=10.4572
- 5A: n=26, MAE=4.9434, MaxErr=8.6875
- 6A: n=54, MAE=3.8260, MaxErr=8.0617
- OOS: n=11, MAE=5.0830, MaxErr=17.3553

Worst 10:
| slug | predicted | official | residual |
|------|-----------|----------|----------|
| tx/neches/neches-tigers | 35.3453 | 17.9900 | 17.3553 |
| tx/brookshire/royal-falcons | 28.7072 | 18.2500 | 10.4572 |
| tx/bellaire/episcopal-knights | 17.8966 | 27.5500 | -9.6534 |
| tx/salado/salado-eagles | 25.0476 | 16.2500 | 8.7976 |
| tx/frisco/wakeland-wolverines | 33.3475 | 24.6600 | 8.6875 |
| tx/el-paso/coronado-thunderbirds | 24.5717 | 16.5100 | 8.0617 |
| tx/prosper/walnut-grove-wildcats | 39.1289 | 31.3300 | 7.7989 |
| tx/edinburg/economedes-jaguars | 21.7966 | 14.2900 | 7.5066 |
| tx/jacksonville/jacksonville-fightin-indians | 23.7613 | 16.5500 | 7.2113 |
| tx/palestine/palestine-wildcats | 23.6745 | 16.5100 | 7.1645 |

## Acceptance bar for new approaches

A new formula must beat this baseline by **≥ 0.20 MAE on the texas-2026 held-out set**.
Current bar: MAE < 4.1937.
