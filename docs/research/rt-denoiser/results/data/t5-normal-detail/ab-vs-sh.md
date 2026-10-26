
### sh-dp8 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.53 | +2.25 | +0.71 | 0.69 → 0.74 | -13.8 | -21.5 | -1.8 | +0.2 | +11 | +3 | ok |
| t5-bounce | sh-specular | settled | +0.99 | +1.01 | +0.92 | 0.31 → 0.38 | -7.0 | -9.1 | -5.7 | -0.9 | -2 | -0 | ok |
| t5-bumpy | sh-diffuse | all | +1.05 | +1.50 | +0.40 | 0.70 → 0.71 | -8.8 | -15.8 | -0.3 | +0.6 | +7 | +2 | ok |
| t5-bumpy | sh-diffuse | settled | +1.12 | +1.53 | +0.45 | 0.70 → 0.72 | -9.4 | -16.3 | -1.2 | +0.5 | +5 | +2 | ok |
| t5-bumpy | sh-specular | all | +0.72 | +0.84 | +0.34 | 0.27 → 0.32 | -6.5 | -9.2 | -3.7 | -0.6 | -5 | -0 | ok |
| t5-bumpy | sh-specular | settled | +0.69 | +0.80 | +0.33 | 0.27 → 0.32 | -6.3 | -8.8 | -3.9 | -0.6 | -6 | -0 | ok |
| t5-fine | sh-diffuse | settled | +0.59 | +0.81 | +0.20 | 0.66 → 0.68 | -5.4 | -6.6 | -0.6 | +1.1 | +7 | +3 | ok |
| t5-fine | sh-specular | settled | +0.86 | +0.84 | +0.94 | 0.17 → 0.25 | -7.1 | -6.8 | -2.9 | -1.7 | +10 | -3 | **fails** (bump +10 %) |
| t5-grooves | sh-diffuse | settled | +1.56 | +1.75 | +0.24 | 0.62 → 0.65 | -11.9 | -15.1 | -1.2 | -1.0 | +3 | +2 | ok |
| t5-grooves | sh-specular | settled | +0.49 | +0.60 | +0.13 | 0.27 → 0.30 | -7.6 | -10.2 | -0.6 | -0.0 | +2 | +1 | ok |
| t5-light-grooves | sh-diffuse | pre | +1.99 | +2.40 | +0.18 | 0.63 → 0.71 | -13.0 | -17.5 | +11.8 | +1.9 | +13 | +2 | **fails** (all +6 %, bump +13 %) |
| t5-light-grooves | sh-diffuse | move | +0.81 | +1.42 | +0.03 | 0.64 → 0.71 | -7.7 | -12.0 | +4.6 | +0.7 | +9 | +1 | **fails** (bump +9 %) |
| t5-light-grooves | sh-diffuse | stop | +1.60 | +1.97 | +0.13 | 0.64 → 0.71 | -9.2 | -13.0 | +7.8 | +1.5 | +14 | +2 | **fails** (all +6 %, bump +14 %) |
| t5-light-grooves | sh-diffuse | hold | +1.84 | +2.16 | +0.21 | 0.64 → 0.71 | -11.1 | -15.0 | +11.7 | +1.9 | +15 | +2 | **fails** (all +7 %, bump +15 %) |
| t5-light-grooves | sh-specular | pre | +1.03 | +1.34 | +0.23 | 0.66 → 0.69 | -9.3 | -12.3 | +4.7 | +1.2 | +1 | +1 | ok |
| t5-light-grooves | sh-specular | move | +0.75 | +1.14 | +0.14 | 0.66 → 0.68 | -8.4 | -11.6 | -0.9 | +0.1 | -1 | +0 | ok |
| t5-light-grooves | sh-specular | stop | +1.02 | +1.32 | +0.31 | 0.67 → 0.69 | -9.2 | -12.4 | +1.8 | +0.7 | -2 | -0 | ok |
| t5-light-grooves | sh-specular | hold | +1.05 | +1.33 | +0.33 | 0.67 → 0.69 | -9.5 | -12.6 | +3.1 | +1.0 | -1 | +0 | ok |
| t5-light-smooth | sh-diffuse | pre | -0.02 | -0.01 | -0.03 | 0.74 → 0.74 | +0.0 | +0.1 | -0.0 | +0.7 | -0 | +1 | ok |
| t5-light-smooth | sh-diffuse | move | -0.01 | -0.00 | -0.01 | 0.78 → 0.78 | +0.0 | +0.0 | -0.0 | +0.3 | -0 | +1 | ok |
| t5-light-smooth | sh-diffuse | stop | -0.02 | -0.01 | -0.03 | 0.80 → 0.80 | +0.1 | +0.0 | -0.0 | +0.6 | -0 | +2 | ok |
| t5-light-smooth | sh-diffuse | hold | -0.01 | -0.01 | -0.02 | 0.80 → 0.80 | -0.1 | +0.1 | -0.0 | +0.8 | -0 | +2 | ok |
| t5-light-smooth | sh-specular | pre | +0.08 | -0.00 | +0.10 | 0.75 → 0.75 | -0.5 | -0.0 | -0.0 | +0.5 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | move | +0.04 | -0.00 | +0.04 | 0.76 → 0.76 | -0.4 | +0.0 | -0.0 | +0.2 | -0 | +0 | ok |
| t5-light-smooth | sh-specular | stop | +0.09 | -0.00 | +0.12 | 0.78 → 0.78 | -0.5 | +0.0 | -0.0 | +0.4 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | hold | +0.11 | -0.00 | +0.15 | 0.78 → 0.78 | -0.6 | +0.0 | -0.0 | +0.5 | -0 | +1 | ok |
| t5-light | sh-diffuse | pre | +1.24 | +1.80 | +0.50 | 0.71 → 0.74 | -9.1 | -15.2 | +16.0 | +1.6 | +21 | +2 | **fails** (all +5 %, bump +21 %) |
| t5-light | sh-diffuse | move | +0.36 | +0.96 | +0.13 | 0.72 → 0.75 | -5.0 | -10.9 | +6.7 | +0.6 | +15 | +1 | **fails** (bump +15 %) |
| t5-light | sh-diffuse | stop | +0.97 | +1.49 | +0.45 | 0.73 → 0.76 | -6.8 | -13.5 | +13.4 | +1.1 | +25 | +2 | **fails** (all +6 %, bump +25 %) |
| t5-light | sh-diffuse | hold | +1.19 | +1.68 | +0.57 | 0.73 → 0.76 | -8.7 | -15.2 | +18.0 | +1.6 | +25 | +2 | **fails** (all +6 %, bump +25 %) |
| t5-light | sh-specular | pre | +1.45 | +1.86 | +0.41 | 0.56 → 0.64 | -9.2 | -12.9 | +2.6 | -0.1 | +1 | +0 | ok |
| t5-light | sh-specular | move | +1.02 | +1.70 | +0.22 | 0.56 → 0.64 | -8.0 | -12.1 | -1.5 | -0.3 | -2 | +0 | ok |
| t5-light | sh-specular | stop | +1.53 | +1.98 | +0.53 | 0.57 → 0.65 | -8.6 | -12.4 | +0.5 | -0.5 | -2 | +0 | ok |
| t5-light | sh-specular | hold | +1.58 | +1.99 | +0.58 | 0.57 → 0.65 | -9.0 | -12.6 | +2.0 | -0.4 | -1 | +0 | ok |
| t5-smooth | sh-diffuse | settled | -0.01 | -0.01 | -0.01 | 0.74 → 0.74 | -0.2 | +0.1 | +0.0 | +0.3 | +0 | +1 | ok |
| t5-smooth | sh-specular | settled | +0.07 | -0.00 | +0.09 | 0.76 → 0.76 | -0.5 | +0.0 | -0.0 | +0.0 | -0 | +0 | ok |

### sh-dp16 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.96 | +3.07 | +0.81 | 0.69 → 0.77 | -18.6 | -29.4 | +3.7 | +0.8 | +32 | +9 | ok |
| t5-bounce | sh-specular | settled | +1.36 | +1.38 | +1.30 | 0.31 → 0.44 | -10.2 | -13.1 | -7.4 | -1.2 | +3 | +2 | ok |
| t5-bumpy | sh-diffuse | all | +1.45 | +2.12 | +0.52 | 0.70 → 0.73 | -12.4 | -22.6 | +3.6 | +1.4 | +29 | +5 | ok |
| t5-bumpy | sh-diffuse | settled | +1.58 | +2.23 | +0.60 | 0.70 → 0.73 | -13.4 | -23.7 | +1.7 | +1.2 | +23 | +6 | ok |
| t5-bumpy | sh-specular | all | +1.04 | +1.21 | +0.52 | 0.27 → 0.35 | -9.4 | -12.7 | -5.5 | -1.1 | -3 | +1 | ok |
| t5-bumpy | sh-specular | settled | +1.02 | +1.18 | +0.52 | 0.27 → 0.35 | -9.1 | -12.3 | -5.9 | -1.0 | -5 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.81 | +1.38 | -0.14 | 0.66 → 0.71 | -8.4 | -12.6 | +4.9 | +2.8 | +40 | +10 | **fails** (bump +40 %) |
| t5-fine | sh-specular | settled | +1.53 | +1.54 | +1.46 | 0.17 → 0.32 | -12.6 | -13.5 | -5.3 | -2.7 | +27 | -2 | **fails** (all +10 %, bump +27 %) |
| t5-grooves | sh-diffuse | settled | +2.46 | +2.78 | +0.40 | 0.62 → 0.68 | -18.8 | -23.7 | -1.6 | -1.4 | +10 | +6 | ok |
| t5-grooves | sh-specular | settled | +0.70 | +0.84 | +0.25 | 0.27 → 0.31 | -11.6 | -15.3 | -1.0 | -0.1 | +4 | +1 | ok |
| t5-light-grooves | sh-diffuse | pre | +3.12 | +3.89 | +0.29 | 0.63 → 0.79 | -20.5 | -27.4 | +22.3 | +4.0 | +25 | +5 | **fails** (all +12 %, bump +25 %) |
| t5-light-grooves | sh-diffuse | move | +1.16 | +2.09 | +0.06 | 0.64 → 0.79 | -12.0 | -18.5 | +8.6 | +1.4 | +17 | +3 | **fails** (all +7 %, bump +17 %) |
| t5-light-grooves | sh-diffuse | stop | +2.47 | +3.09 | +0.23 | 0.64 → 0.79 | -14.9 | -20.8 | +14.5 | +3.1 | +24 | +5 | **fails** (all +11 %, bump +24 %) |
| t5-light-grooves | sh-diffuse | hold | +2.92 | +3.51 | +0.36 | 0.64 → 0.79 | -18.1 | -24.3 | +21.6 | +4.0 | +27 | +5 | **fails** (all +12 %, bump +27 %, flat +5 %) |
| t5-light-grooves | sh-specular | pre | +1.53 | +2.00 | +0.40 | 0.66 → 0.70 | -14.4 | -18.7 | +8.6 | +2.4 | +2 | +1 | ok |
| t5-light-grooves | sh-specular | move | +1.09 | +1.65 | +0.25 | 0.66 → 0.70 | -12.8 | -17.3 | -0.7 | +0.3 | +0 | +0 | ok |
| t5-light-grooves | sh-specular | stop | +1.51 | +1.93 | +0.55 | 0.67 → 0.71 | -13.8 | -18.3 | +4.0 | +1.6 | -2 | +1 | ok |
| t5-light-grooves | sh-specular | hold | +1.56 | +1.96 | +0.59 | 0.67 → 0.71 | -14.3 | -18.8 | +6.0 | +2.2 | -0 | +1 | ok |
| t5-light-smooth | sh-diffuse | pre | -0.05 | -0.02 | -0.06 | 0.74 → 0.74 | +0.0 | +0.1 | -0.1 | +1.4 | -0 | +3 | ok |
| t5-light-smooth | sh-diffuse | move | -0.01 | -0.01 | -0.01 | 0.78 → 0.78 | +0.0 | +0.1 | -0.0 | +0.7 | -0 | +2 | ok |
| t5-light-smooth | sh-diffuse | stop | -0.05 | -0.02 | -0.06 | 0.80 → 0.80 | +0.1 | +0.1 | -0.1 | +1.3 | -0 | +3 | ok |
| t5-light-smooth | sh-diffuse | hold | -0.03 | -0.03 | -0.03 | 0.80 → 0.80 | -0.1 | +0.1 | -0.1 | +1.6 | -0 | +3 | ok |
| t5-light-smooth | sh-specular | pre | +0.14 | -0.00 | +0.18 | 0.75 → 0.75 | -0.9 | -0.0 | -0.1 | +0.9 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | move | +0.06 | -0.00 | +0.07 | 0.76 → 0.76 | -0.7 | +0.0 | -0.0 | +0.3 | -0 | +0 | ok |
| t5-light-smooth | sh-specular | stop | +0.16 | -0.00 | +0.21 | 0.78 → 0.78 | -0.8 | +0.0 | -0.0 | +0.9 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | hold | +0.20 | -0.00 | +0.26 | 0.78 → 0.78 | -1.0 | +0.0 | -0.1 | +1.0 | -0 | +2 | ok |
| t5-light | sh-diffuse | pre | +1.80 | +2.75 | +0.65 | 0.71 → 0.79 | -13.4 | -22.9 | +39.0 | +3.0 | +69 | +4 | **fails** (all +16 %, bump +69 %) |
| t5-light | sh-diffuse | move | +0.50 | +1.39 | +0.17 | 0.72 → 0.80 | -7.2 | -15.7 | +17.0 | +1.1 | +40 | +2 | **fails** (all +8 %, bump +40 %) |
| t5-light | sh-diffuse | stop | +1.34 | +2.16 | +0.57 | 0.73 → 0.80 | -9.8 | -19.3 | +33.9 | +2.1 | +69 | +4 | **fails** (all +15 %, bump +69 %) |
| t5-light | sh-diffuse | hold | +1.72 | +2.55 | +0.74 | 0.73 → 0.80 | -12.9 | -22.4 | +44.5 | +2.9 | +75 | +4 | **fails** (all +17 %, bump +75 %) |
| t5-light | sh-specular | pre | +1.96 | +2.52 | +0.62 | 0.56 → 0.70 | -13.0 | -17.3 | +6.7 | +0.2 | +4 | +1 | ok |
| t5-light | sh-specular | move | +1.37 | +2.30 | +0.33 | 0.56 → 0.70 | -11.7 | -17.0 | -0.5 | -0.3 | -1 | +0 | ok |
| t5-light | sh-specular | stop | +2.08 | +2.70 | +0.80 | 0.57 → 0.71 | -12.7 | -17.6 | +3.8 | -0.4 | +1 | +1 | ok |
| t5-light | sh-specular | hold | +2.16 | +2.72 | +0.87 | 0.57 → 0.72 | -13.3 | -17.9 | +6.2 | -0.2 | +2 | +1 | ok |
| t5-smooth | sh-diffuse | settled | -0.02 | -0.03 | -0.02 | 0.74 → 0.74 | -0.3 | +0.1 | +0.0 | +0.6 | +1 | +3 | ok |
| t5-smooth | sh-specular | settled | +0.13 | -0.00 | +0.16 | 0.76 → 0.76 | -0.9 | +0.0 | -0.0 | +0.0 | -0 | +0 | ok |

### sh-dp32 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +2.02 | +3.34 | +0.71 | 0.69 → 0.81 | -20.9 | -33.1 | +16.9 | +1.8 | +73 | +18 | **fails** (bump +73 %) |
| t5-bounce | sh-specular | settled | +1.65 | +1.66 | +1.61 | 0.31 → 0.50 | -13.3 | -17.0 | -8.9 | -1.5 | +12 | +6 | **fails** (bump +12 %) |
| t5-bumpy | sh-diffuse | all | +1.53 | +2.24 | +0.56 | 0.70 → 0.76 | -14.3 | -26.0 | +14.1 | +3.1 | +76 | +13 | **fails** (bump +76 %) |
| t5-bumpy | sh-diffuse | settled | +1.81 | +2.59 | +0.66 | 0.70 → 0.76 | -15.8 | -27.9 | +10.2 | +2.5 | +65 | +14 | **fails** (bump +65 %) |
| t5-bumpy | sh-specular | all | +1.28 | +1.46 | +0.74 | 0.27 → 0.40 | -11.7 | -14.8 | -6.2 | -1.6 | +4 | +2 | ok |
| t5-bumpy | sh-specular | settled | +1.26 | +1.43 | +0.74 | 0.27 → 0.39 | -11.6 | -14.6 | -6.8 | -1.6 | +2 | +1 | ok |
| t5-fine | sh-diffuse | settled | +0.50 | +1.33 | -0.78 | 0.66 → 0.76 | -10.1 | -16.7 | +27.6 | +6.5 | +137 | +28 | **fails** (all +81 %, bump +137 %) |
| t5-fine | sh-specular | settled | +2.33 | +2.38 | +1.98 | 0.17 → 0.41 | -19.4 | -22.0 | -8.2 | -3.9 | +53 | +2 | **fails** (all +24 %, bump +53 %) |
| t5-grooves | sh-diffuse | settled | +3.28 | +3.75 | +0.57 | 0.62 → 0.72 | -25.4 | -31.7 | -0.4 | -1.0 | +24 | +13 | ok |
| t5-grooves | sh-specular | settled | +0.95 | +1.12 | +0.43 | 0.27 → 0.33 | -15.7 | -20.2 | -1.5 | -0.2 | +7 | +2 | ok |
| t5-light-grooves | sh-diffuse | pre | +3.97 | +5.10 | +0.37 | 0.63 → 0.88 | -26.8 | -35.6 | +39.1 | +8.6 | +46 | +10 | **fails** (all +23 %, bump +46 %, flat +10 %) |
| t5-light-grooves | sh-diffuse | move | +1.38 | +2.52 | +0.08 | 0.64 → 0.88 | -15.3 | -23.5 | +14.9 | +3.1 | +28 | +6 | **fails** (all +13 %, bump +28 %, flat +6 %) |
| t5-light-grooves | sh-diffuse | stop | +3.05 | +3.90 | +0.29 | 0.64 → 0.88 | -19.9 | -27.6 | +25.1 | +7.0 | +39 | +10 | **fails** (all +20 %, bump +39 %, flat +10 %) |
| t5-light-grooves | sh-diffuse | hold | +3.74 | +4.57 | +0.51 | 0.64 → 0.88 | -24.5 | -32.4 | +36.6 | +8.9 | +45 | +11 | **fails** (all +23 %, bump +45 %, flat +11 %) |
| t5-light-grooves | sh-specular | pre | +2.04 | +2.63 | +0.66 | 0.66 → 0.72 | -19.8 | -25.2 | +14.4 | +5.1 | +5 | +3 | **fails** (bump +5 %) |
| t5-light-grooves | sh-specular | move | +1.43 | +2.13 | +0.43 | 0.66 → 0.72 | -17.2 | -22.7 | +0.5 | +0.9 | +2 | +1 | ok |
| t5-light-grooves | sh-specular | stop | +2.03 | +2.53 | +0.92 | 0.67 → 0.73 | -18.5 | -23.7 | +8.0 | +4.0 | +0 | +3 | ok |
| t5-light-grooves | sh-specular | hold | +2.11 | +2.59 | +0.97 | 0.67 → 0.73 | -19.3 | -24.6 | +10.7 | +4.9 | +2 | +4 | ok |
| t5-light-smooth | sh-diffuse | pre | -0.09 | -0.04 | -0.12 | 0.74 → 0.74 | +0.2 | +0.2 | -0.1 | +2.8 | -0 | +6 | **fails** (flat +6 %) |
| t5-light-smooth | sh-diffuse | move | -0.02 | -0.01 | -0.02 | 0.78 → 0.78 | +0.1 | +0.1 | -0.0 | +1.3 | -0 | +4 | ok |
| t5-light-smooth | sh-diffuse | stop | -0.09 | -0.04 | -0.12 | 0.80 → 0.80 | +0.3 | +0.2 | -0.1 | +2.5 | -0 | +6 | **fails** (all +5 %, flat +6 %) |
| t5-light-smooth | sh-diffuse | hold | -0.07 | -0.06 | -0.08 | 0.80 → 0.80 | -0.1 | +0.2 | -0.1 | +3.1 | -0 | +6 | **fails** (all +5 %, flat +6 %) |
| t5-light-smooth | sh-specular | pre | +0.21 | -0.00 | +0.27 | 0.75 → 0.75 | -1.5 | -0.0 | -0.1 | +1.8 | -0 | +2 | ok |
| t5-light-smooth | sh-specular | move | +0.10 | -0.00 | +0.12 | 0.76 → 0.76 | -1.2 | +0.0 | -0.1 | +0.7 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | stop | +0.26 | -0.01 | +0.34 | 0.78 → 0.78 | -1.4 | +0.0 | -0.1 | +1.7 | -0 | +3 | ok |
| t5-light-smooth | sh-specular | hold | +0.31 | -0.01 | +0.41 | 0.78 → 0.78 | -1.7 | +0.0 | -0.1 | +2.0 | -0 | +4 | ok |
| t5-light | sh-diffuse | pre | +1.97 | +3.05 | +0.70 | 0.71 → 0.87 | -15.5 | -26.2 | +79.9 | +5.2 | +156 | +7 | **fails** (all +41 %, bump +156 %, flat +7 %) |
| t5-light | sh-diffuse | move | +0.54 | +1.51 | +0.19 | 0.72 → 0.87 | -8.5 | -17.7 | +35.7 | +2.0 | +89 | +5 | **fails** (all +18 %, bump +89 %) |
| t5-light | sh-diffuse | stop | +1.35 | +2.18 | +0.57 | 0.73 → 0.87 | -11.0 | -20.9 | +70.9 | +3.8 | +144 | +7 | **fails** (all +35 %, bump +144 %, flat +7 %) |
| t5-light | sh-diffuse | hold | +1.85 | +2.79 | +0.78 | 0.73 → 0.88 | -15.2 | -25.6 | +91.3 | +5.1 | +162 | +7 | **fails** (all +41 %, bump +162 %, flat +7 %) |
| t5-light | sh-specular | pre | +2.00 | +2.45 | +0.86 | 0.56 → 0.77 | -15.1 | -18.3 | +14.2 | +1.2 | +10 | +2 | **fails** (all +6 %, bump +10 %) |
| t5-light | sh-specular | move | +1.43 | +2.28 | +0.46 | 0.56 → 0.77 | -13.8 | -18.5 | +2.8 | -0.2 | +3 | +0 | ok |
| t5-light | sh-specular | stop | +2.18 | +2.68 | +1.09 | 0.57 → 0.78 | -15.1 | -19.3 | +10.6 | +0.3 | +8 | +2 | **fails** (bump +8 %) |
| t5-light | sh-specular | hold | +2.27 | +2.72 | +1.19 | 0.57 → 0.79 | -15.9 | -19.7 | +14.0 | +0.6 | +9 | +3 | **fails** (all +5 %, bump +9 %) |
| t5-smooth | sh-diffuse | settled | -0.05 | -0.05 | -0.05 | 0.74 → 0.74 | -0.5 | +0.3 | +0.1 | +1.3 | +1 | +6 | ok |
| t5-smooth | sh-specular | settled | +0.20 | -0.01 | +0.26 | 0.76 → 0.76 | -1.4 | +0.1 | -0.0 | +0.1 | -0 | +1 | ok |

### sh-dp16p vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.96 | +3.06 | +0.81 | 0.69 → 0.77 | -18.6 | -29.4 | +4.0 | +0.8 | +33 | +9 | ok |
| t5-bounce | sh-specular | settled | +1.36 | +1.38 | +1.30 | 0.31 → 0.44 | -10.2 | -13.1 | -7.2 | -1.2 | +5 | +2 | **fails** (bump +5 %) |
| t5-bumpy | sh-diffuse | settled | +1.58 | +2.22 | +0.60 | 0.70 → 0.73 | -13.4 | -23.7 | +1.8 | +1.2 | +24 | +6 | ok |
| t5-bumpy | sh-specular | settled | +1.02 | +1.18 | +0.52 | 0.27 → 0.35 | -9.1 | -12.3 | -5.7 | -1.0 | -4 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.81 | +1.38 | -0.14 | 0.66 → 0.71 | -8.4 | -12.6 | +4.9 | +2.9 | +40 | +10 | **fails** (bump +40 %) |
| t5-fine | sh-specular | settled | +1.53 | +1.54 | +1.46 | 0.17 → 0.32 | -12.6 | -13.5 | -5.3 | -2.7 | +28 | -2 | **fails** (all +10 %, bump +28 %) |
| t5-grooves | sh-diffuse | settled | +2.46 | +2.78 | +0.40 | 0.62 → 0.68 | -18.8 | -23.7 | -1.5 | -1.4 | +10 | +6 | ok |
| t5-grooves | sh-specular | settled | +0.70 | +0.84 | +0.25 | 0.27 → 0.31 | -11.6 | -15.3 | -1.0 | -0.0 | +4 | +1 | ok |
| t5-light-grooves | sh-diffuse | pre | +3.12 | +3.89 | +0.29 | 0.63 → 0.79 | -20.5 | -27.4 | +22.3 | +4.0 | +25 | +5 | **fails** (all +12 %, bump +25 %) |
| t5-light-grooves | sh-diffuse | move | +1.16 | +2.09 | +0.06 | 0.64 → 0.79 | -12.0 | -18.5 | +8.6 | +1.4 | +17 | +3 | **fails** (all +7 %, bump +17 %) |
| t5-light-grooves | sh-diffuse | stop | +2.47 | +3.09 | +0.23 | 0.64 → 0.79 | -14.9 | -20.8 | +14.5 | +3.2 | +24 | +5 | **fails** (all +11 %, bump +24 %) |
| t5-light-grooves | sh-diffuse | hold | +2.92 | +3.51 | +0.36 | 0.64 → 0.79 | -18.1 | -24.3 | +21.6 | +4.1 | +27 | +5 | **fails** (all +13 %, bump +27 %, flat +5 %) |
| t5-light-grooves | sh-specular | pre | +1.53 | +2.00 | +0.40 | 0.66 → 0.70 | -14.4 | -18.7 | +8.6 | +2.5 | +2 | +1 | ok |
| t5-light-grooves | sh-specular | move | +1.09 | +1.66 | +0.25 | 0.66 → 0.70 | -12.8 | -17.3 | -0.7 | +0.3 | +0 | +0 | ok |
| t5-light-grooves | sh-specular | stop | +1.51 | +1.93 | +0.55 | 0.67 → 0.71 | -13.8 | -18.3 | +4.0 | +1.6 | -2 | +1 | ok |
| t5-light-grooves | sh-specular | hold | +1.56 | +1.96 | +0.59 | 0.67 → 0.71 | -14.3 | -18.8 | +6.0 | +2.2 | -0 | +1 | ok |
| t5-light-smooth | sh-diffuse | pre | -0.05 | -0.02 | -0.06 | 0.74 → 0.74 | +0.0 | +0.1 | -0.1 | +1.4 | -0 | +3 | ok |
| t5-light-smooth | sh-diffuse | move | -0.01 | -0.01 | -0.01 | 0.78 → 0.78 | +0.0 | +0.1 | -0.0 | +0.7 | -0 | +2 | ok |
| t5-light-smooth | sh-diffuse | stop | -0.05 | -0.02 | -0.06 | 0.80 → 0.80 | +0.1 | +0.1 | -0.1 | +1.3 | -0 | +3 | ok |
| t5-light-smooth | sh-diffuse | hold | -0.03 | -0.03 | -0.03 | 0.80 → 0.80 | -0.1 | +0.1 | -0.1 | +1.6 | -0 | +3 | ok |
| t5-light-smooth | sh-specular | pre | +0.14 | -0.00 | +0.18 | 0.75 → 0.75 | -0.9 | -0.0 | -0.1 | +0.9 | -0 | +1 | ok |
| t5-light-smooth | sh-specular | move | +0.06 | -0.00 | +0.07 | 0.76 → 0.76 | -0.7 | +0.0 | -0.0 | +0.3 | -0 | +0 | ok |
| t5-light-smooth | sh-specular | stop | +0.16 | -0.00 | +0.21 | 0.78 → 0.78 | -0.9 | +0.0 | -0.0 | +0.9 | -0 | +2 | ok |
| t5-light-smooth | sh-specular | hold | +0.20 | -0.00 | +0.26 | 0.78 → 0.78 | -1.0 | +0.0 | -0.1 | +1.0 | -0 | +2 | ok |
| t5-light | sh-diffuse | pre | +1.80 | +2.74 | +0.66 | 0.71 → 0.79 | -13.4 | -22.9 | +39.1 | +3.0 | +69 | +4 | **fails** (all +16 %, bump +69 %) |
| t5-light | sh-diffuse | move | +0.50 | +1.39 | +0.17 | 0.72 → 0.80 | -7.3 | -15.7 | +17.0 | +1.1 | +40 | +2 | **fails** (all +8 %, bump +40 %) |
| t5-light | sh-diffuse | stop | +1.34 | +2.16 | +0.57 | 0.73 → 0.80 | -9.8 | -19.3 | +33.9 | +2.1 | +69 | +4 | **fails** (all +15 %, bump +69 %) |
| t5-light | sh-diffuse | hold | +1.72 | +2.54 | +0.75 | 0.73 → 0.80 | -13.0 | -22.4 | +44.5 | +2.9 | +75 | +4 | **fails** (all +17 %, bump +75 %) |
| t5-light | sh-specular | pre | +1.96 | +2.51 | +0.62 | 0.56 → 0.70 | -13.0 | -17.3 | +6.7 | +0.3 | +4 | +1 | ok |
| t5-light | sh-specular | move | +1.37 | +2.30 | +0.33 | 0.56 → 0.70 | -11.7 | -17.0 | -0.5 | -0.3 | -1 | +0 | ok |
| t5-light | sh-specular | stop | +2.08 | +2.70 | +0.80 | 0.57 → 0.71 | -12.7 | -17.6 | +3.8 | -0.4 | +1 | +1 | ok |
| t5-light | sh-specular | hold | +2.16 | +2.71 | +0.87 | 0.57 → 0.72 | -13.3 | -17.9 | +6.2 | -0.2 | +2 | +1 | ok |
| t5-smooth | sh-diffuse | settled | -0.02 | -0.03 | -0.02 | 0.74 → 0.74 | -0.3 | +0.1 | +0.0 | +0.7 | +1 | +3 | ok |
| t5-smooth | sh-specular | settled | +0.13 | -0.00 | +0.16 | 0.76 → 0.76 | -0.9 | +0.0 | -0.0 | +0.0 | -0 | +0 | ok |

### sh-s1 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | -0.02 | -0.03 | -0.00 | 0.69 → 0.75 | -0.1 | +0.1 | -2.9 | -0.4 | +6 | +1 | ok |
| t5-bounce | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.31 → 0.31 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-bumpy | sh-diffuse | settled | +0.05 | +0.08 | +0.00 | 0.70 → 0.76 | -1.1 | -2.0 | -3.3 | -1.3 | +6 | +1 | ok |
| t5-bumpy | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.27 → 0.27 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.07 | +0.11 | -0.00 | 0.66 → 0.74 | -1.2 | -2.0 | -5.6 | -2.6 | +9 | +3 | ok |
| t5-fine | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.17 → 0.17 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-grooves | sh-diffuse | settled | +0.20 | +0.22 | +0.03 | 0.62 → 0.68 | -1.9 | -2.3 | -4.0 | -2.5 | +6 | +0 | ok |
| t5-grooves | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.27 → 0.27 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-diffuse | pre | +0.02 | +0.03 | +0.00 | 0.71 → 0.77 | -0.3 | -0.3 | -0.1 | -0.0 | -0 | -0 | ok |
| t5-light | sh-diffuse | move | -0.01 | -0.05 | +0.00 | 0.72 → 0.78 | -0.6 | -1.3 | +0.0 | -0.0 | -0 | -0 | ok |
| t5-light | sh-diffuse | stop | -0.02 | -0.04 | +0.00 | 0.73 → 0.79 | -1.1 | -2.4 | -0.0 | -0.0 | +0 | -0 | ok |
| t5-light | sh-diffuse | hold | -0.00 | -0.01 | +0.00 | 0.73 → 0.78 | -0.9 | -1.7 | -0.0 | -0.0 | +0 | -0 | ok |
| t5-light | sh-specular | pre | +0.00 | +0.00 | +0.00 | 0.56 → 0.56 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | move | +0.00 | +0.00 | +0.00 | 0.56 → 0.56 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | stop | +0.00 | +0.00 | +0.00 | 0.57 → 0.57 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | hold | +0.00 | +0.00 | +0.00 | 0.57 → 0.57 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |

### sh-y16 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +0.00 | +0.00 | +0.00 | 0.69 → 0.69 | -0.0 | +0.0 | -0.0 | -0.0 | +0 | -0 | ok |
| t5-bounce | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.31 → 0.31 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-bumpy | sh-diffuse | all | +0.02 | +0.00 | +0.05 | 0.70 → 0.70 | -0.2 | -0.0 | +0.0 | -0.6 | +0 | -4 | ok |
| t5-bumpy | sh-diffuse | settled | +0.00 | +0.00 | +0.00 | 0.70 → 0.70 | +0.0 | -0.0 | -0.0 | -0.0 | -0 | -0 | ok |
| t5-bumpy | sh-specular | all | +0.00 | +0.00 | +0.00 | 0.27 → 0.27 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-bumpy | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.27 → 0.27 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.00 | +0.00 | +0.00 | 0.66 → 0.66 | +0.0 | -0.0 | +0.0 | -0.0 | +0 | -0 | ok |
| t5-fine | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.17 → 0.17 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-grooves | sh-diffuse | settled | -0.00 | +0.00 | -0.00 | 0.62 → 0.62 | +0.0 | -0.0 | -0.0 | -0.0 | -0 | -0 | ok |
| t5-grooves | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.27 → 0.27 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-grooves | sh-diffuse | pre | +0.00 | -0.00 | +0.00 | 0.63 → 0.63 | -0.0 | +0.0 | -0.0 | -0.0 | -0 | -0 | ok |
| t5-light-grooves | sh-diffuse | move | +0.01 | +0.01 | +0.02 | 0.64 → 0.64 | -0.1 | -0.0 | +0.1 | -2.2 | +0 | -7 | ok |
| t5-light-grooves | sh-diffuse | stop | +0.01 | +0.00 | +0.06 | 0.64 → 0.64 | -0.2 | -0.0 | -0.0 | -1.4 | +0 | -4 | ok |
| t5-light-grooves | sh-diffuse | hold | +0.00 | +0.00 | +0.02 | 0.64 → 0.64 | -0.1 | -0.0 | -0.0 | -0.5 | +0 | -2 | ok |
| t5-light-grooves | sh-specular | pre | +0.00 | +0.00 | +0.00 | 0.66 → 0.66 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-grooves | sh-specular | move | +0.00 | +0.00 | +0.00 | 0.66 → 0.66 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-grooves | sh-specular | stop | +0.00 | +0.00 | +0.00 | 0.67 → 0.67 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-grooves | sh-specular | hold | +0.00 | +0.00 | +0.00 | 0.67 → 0.67 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-smooth | sh-diffuse | pre | +0.00 | +0.00 | +0.00 | 0.74 → 0.74 | -0.0 | -0.0 | +0.0 | -0.0 | +0 | -0 | ok |
| t5-light-smooth | sh-diffuse | move | +0.02 | +0.02 | +0.02 | 0.78 → 0.78 | -0.1 | -0.1 | +0.0 | -1.6 | +0 | -6 | ok |
| t5-light-smooth | sh-diffuse | stop | +0.04 | +0.00 | +0.05 | 0.80 → 0.80 | -0.3 | -0.0 | -0.1 | -0.9 | +0 | -3 | ok |
| t5-light-smooth | sh-diffuse | hold | +0.01 | +0.00 | +0.02 | 0.80 → 0.80 | -0.1 | -0.0 | -0.0 | -0.4 | +0 | -2 | ok |
| t5-light-smooth | sh-specular | pre | +0.00 | +0.00 | +0.00 | 0.75 → 0.75 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-smooth | sh-specular | move | +0.00 | +0.00 | +0.00 | 0.76 → 0.76 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-smooth | sh-specular | stop | +0.00 | +0.00 | +0.00 | 0.78 → 0.78 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light-smooth | sh-specular | hold | +0.00 | +0.00 | +0.00 | 0.78 → 0.78 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-diffuse | pre | +0.00 | -0.00 | +0.00 | 0.71 → 0.71 | -0.0 | -0.0 | +0.0 | -0.0 | +0 | -0 | ok |
| t5-light | sh-diffuse | move | +0.02 | +0.01 | +0.02 | 0.72 → 0.72 | -0.1 | -0.0 | +0.1 | -1.6 | +0 | -6 | ok |
| t5-light | sh-diffuse | stop | +0.02 | +0.00 | +0.04 | 0.73 → 0.73 | -0.2 | -0.0 | -0.0 | -0.9 | +0 | -3 | ok |
| t5-light | sh-diffuse | hold | +0.01 | +0.00 | +0.01 | 0.73 → 0.73 | -0.1 | -0.0 | -0.0 | -0.4 | +0 | -2 | ok |
| t5-light | sh-specular | pre | +0.00 | +0.00 | +0.00 | 0.56 → 0.56 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | move | +0.00 | +0.00 | +0.00 | 0.56 → 0.56 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | stop | +0.00 | +0.00 | +0.00 | 0.57 → 0.57 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-light | sh-specular | hold | +0.00 | +0.00 | +0.00 | 0.57 → 0.57 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |
| t5-smooth | sh-diffuse | settled | +0.00 | +0.00 | +0.00 | 0.74 → 0.74 | +0.0 | +0.0 | -0.0 | -0.0 | -0 | -0 | ok |
| t5-smooth | sh-specular | settled | +0.00 | +0.00 | +0.00 | 0.76 → 0.76 | +0.0 | +0.0 | +0.0 | +0.0 | +0 | +0 | ok |

### sh-dp8-s1 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.55 | +2.28 | +0.71 | 0.69 → 0.79 | -14.1 | -21.9 | -4.6 | -0.2 | +16 | +4 | ok |
| t5-bounce | sh-specular | settled | +0.99 | +1.01 | +0.92 | 0.31 → 0.38 | -7.0 | -9.1 | -5.7 | -0.9 | -2 | -0 | ok |
| t5-bumpy | sh-diffuse | settled | +1.21 | +1.69 | +0.45 | 0.70 → 0.77 | -10.5 | -18.4 | -4.6 | -0.8 | +10 | +3 | ok |
| t5-bumpy | sh-specular | settled | +0.69 | +0.80 | +0.33 | 0.27 → 0.32 | -6.3 | -8.8 | -3.9 | -0.6 | -6 | -0 | ok |
| t5-fine | sh-diffuse | settled | +0.72 | +1.01 | +0.20 | 0.66 → 0.76 | -6.7 | -9.2 | -6.2 | -1.5 | +15 | +6 | ok |
| t5-fine | sh-specular | settled | +0.86 | +0.84 | +0.94 | 0.17 → 0.25 | -7.1 | -6.8 | -2.9 | -1.7 | +10 | -3 | **fails** (bump +10 %) |
| t5-grooves | sh-diffuse | settled | +1.88 | +2.12 | +0.26 | 0.62 → 0.71 | -14.4 | -18.3 | -5.3 | -3.2 | +8 | +3 | ok |
| t5-grooves | sh-specular | settled | +0.49 | +0.60 | +0.13 | 0.27 → 0.30 | -7.6 | -10.2 | -0.6 | -0.0 | +2 | +1 | ok |
| t5-light | sh-diffuse | pre | +1.31 | +1.93 | +0.50 | 0.71 → 0.80 | -9.7 | -16.3 | +15.6 | +1.6 | +21 | +2 | **fails** (all +5 %, bump +21 %) |
| t5-light | sh-diffuse | move | +0.35 | +0.95 | +0.13 | 0.72 → 0.80 | -5.5 | -12.3 | +6.7 | +0.6 | +14 | +1 | **fails** (bump +14 %) |
| t5-light | sh-diffuse | stop | +0.96 | +1.48 | +0.45 | 0.73 → 0.81 | -7.7 | -15.7 | +13.2 | +1.1 | +25 | +2 | **fails** (all +6 %, bump +25 %) |
| t5-light | sh-diffuse | hold | +1.20 | +1.71 | +0.57 | 0.73 → 0.81 | -9.5 | -16.9 | +17.7 | +1.6 | +25 | +2 | **fails** (all +6 %, bump +25 %) |
| t5-light | sh-specular | pre | +1.45 | +1.86 | +0.41 | 0.56 → 0.64 | -9.2 | -12.9 | +2.6 | -0.1 | +1 | +0 | ok |
| t5-light | sh-specular | move | +1.02 | +1.70 | +0.22 | 0.56 → 0.64 | -8.0 | -12.1 | -1.5 | -0.3 | -2 | +0 | ok |
| t5-light | sh-specular | stop | +1.53 | +1.98 | +0.53 | 0.57 → 0.65 | -8.6 | -12.4 | +0.5 | -0.5 | -2 | +0 | ok |
| t5-light | sh-specular | hold | +1.58 | +1.99 | +0.58 | 0.57 → 0.65 | -9.0 | -12.6 | +2.0 | -0.4 | -1 | +0 | ok |

### sh-dp16-s1 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.90 | +2.93 | +0.81 | 0.69 → 0.82 | -18.5 | -28.8 | +1.4 | +0.4 | +35 | +9 | ok |
| t5-bounce | sh-specular | settled | +1.36 | +1.38 | +1.30 | 0.31 → 0.44 | -10.2 | -13.1 | -7.4 | -1.2 | +3 | +2 | ok |
| t5-bumpy | sh-diffuse | settled | +1.66 | +2.36 | +0.60 | 0.70 → 0.79 | -14.0 | -24.5 | -1.6 | -0.1 | +27 | +7 | ok |
| t5-bumpy | sh-specular | settled | +1.02 | +1.18 | +0.52 | 0.27 → 0.35 | -9.1 | -12.3 | -5.9 | -1.0 | -5 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.95 | +1.63 | -0.14 | 0.66 → 0.78 | -9.9 | -15.5 | -0.5 | +0.3 | +47 | +12 | **fails** (bump +47 %) |
| t5-fine | sh-specular | settled | +1.53 | +1.54 | +1.46 | 0.17 → 0.32 | -12.6 | -13.5 | -5.3 | -2.7 | +27 | -2 | **fails** (all +10 %, bump +27 %) |
| t5-grooves | sh-diffuse | settled | +2.78 | +3.16 | +0.42 | 0.62 → 0.74 | -21.2 | -26.8 | -5.6 | -3.5 | +14 | +6 | ok |
| t5-grooves | sh-specular | settled | +0.70 | +0.84 | +0.25 | 0.27 → 0.31 | -11.6 | -15.3 | -1.0 | -0.1 | +4 | +1 | ok |
| t5-light | sh-diffuse | pre | +1.85 | +2.84 | +0.65 | 0.71 → 0.83 | -13.8 | -23.5 | +38.8 | +3.0 | +69 | +4 | **fails** (all +16 %, bump +69 %) |
| t5-light | sh-diffuse | move | +0.49 | +1.37 | +0.17 | 0.72 → 0.84 | -7.6 | -16.4 | +17.0 | +1.1 | +40 | +2 | **fails** (all +8 %, bump +40 %) |
| t5-light | sh-diffuse | stop | +1.31 | +2.10 | +0.57 | 0.73 → 0.84 | -10.2 | -20.0 | +33.7 | +2.1 | +69 | +4 | **fails** (all +15 %, bump +69 %) |
| t5-light | sh-diffuse | hold | +1.69 | +2.49 | +0.74 | 0.73 → 0.84 | -13.2 | -22.7 | +44.3 | +2.9 | +76 | +4 | **fails** (all +17 %, bump +76 %) |
| t5-light | sh-specular | pre | +1.96 | +2.52 | +0.62 | 0.56 → 0.70 | -13.0 | -17.3 | +6.7 | +0.2 | +4 | +1 | ok |
| t5-light | sh-specular | move | +1.37 | +2.30 | +0.33 | 0.56 → 0.70 | -11.7 | -17.0 | -0.5 | -0.3 | -1 | +0 | ok |
| t5-light | sh-specular | stop | +2.08 | +2.70 | +0.80 | 0.57 → 0.71 | -12.7 | -17.6 | +3.8 | -0.4 | +1 | +1 | ok |
| t5-light | sh-specular | hold | +2.16 | +2.72 | +0.87 | 0.57 → 0.72 | -13.3 | -17.9 | +6.2 | -0.2 | +2 | +1 | ok |

### sh-dp16-st4 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +1.97 | +2.98 | +0.90 | 0.69 → 0.75 | -18.0 | -28.5 | +1.9 | +0.4 | +22 | +4 | ok |
| t5-bounce | sh-specular | settled | +0.98 | +0.99 | +0.96 | 0.31 → 0.38 | -8.1 | -10.4 | -4.8 | -0.5 | -2 | +1 | ok |
| t5-bumpy | sh-diffuse | settled | +1.46 | +2.10 | +0.49 | 0.70 → 0.72 | -12.8 | -23.2 | +0.6 | +1.0 | +10 | +3 | ok |
| t5-bumpy | sh-specular | settled | +0.72 | +0.82 | +0.39 | 0.27 → 0.31 | -7.6 | -10.6 | -4.0 | -0.4 | -7 | -0 | ok |
| t5-fine | sh-diffuse | settled | +0.70 | +1.02 | +0.13 | 0.66 → 0.69 | -6.0 | -8.7 | +2.3 | +2.2 | +17 | +6 | ok |
| t5-fine | sh-specular | settled | +0.69 | +0.71 | +0.54 | 0.17 → 0.23 | -6.8 | -7.6 | -2.2 | -0.3 | +6 | +0 | **fails** (bump +6 %) |
| t5-grooves | sh-diffuse | settled | +1.90 | +2.12 | +0.37 | 0.62 → 0.64 | -17.0 | -21.4 | +0.9 | -0.3 | +7 | +4 | ok |
| t5-grooves | sh-specular | settled | +0.48 | +0.58 | +0.16 | 0.27 → 0.28 | -10.0 | -13.1 | -0.5 | -0.2 | +0 | +0 | ok |
| t5-light | sh-diffuse | pre | +1.54 | +2.36 | +0.51 | 0.71 → 0.74 | -11.6 | -21.6 | +29.4 | +2.4 | +35 | +3 | **fails** (all +8 %, bump +35 %) |
| t5-light | sh-diffuse | move | +0.43 | +1.20 | +0.14 | 0.72 → 0.75 | -5.9 | -14.4 | +13.2 | +1.0 | +30 | +2 | **fails** (all +6 %, bump +30 %) |
| t5-light | sh-diffuse | stop | +1.10 | +1.79 | +0.44 | 0.73 → 0.76 | -8.1 | -18.0 | +26.1 | +1.9 | +48 | +3 | **fails** (all +10 %, bump +48 %) |
| t5-light | sh-diffuse | hold | +1.40 | +2.10 | +0.56 | 0.73 → 0.75 | -11.0 | -21.0 | +34.0 | +2.5 | +47 | +3 | **fails** (all +10 %, bump +47 %) |
| t5-light | sh-specular | pre | +1.31 | +1.61 | +0.49 | 0.56 → 0.61 | -9.9 | -13.9 | +2.3 | +0.4 | +1 | +1 | ok |
| t5-light | sh-specular | move | +0.95 | +1.51 | +0.27 | 0.56 → 0.61 | -8.8 | -13.5 | -2.7 | -0.3 | -2 | +0 | ok |
| t5-light | sh-specular | stop | +1.41 | +1.74 | +0.65 | 0.57 → 0.63 | -9.5 | -13.8 | +0.2 | -0.3 | -2 | +1 | ok |
| t5-light | sh-specular | hold | +1.46 | +1.75 | +0.70 | 0.57 → 0.63 | -10.0 | -14.1 | +1.8 | -0.1 | -1 | +1 | ok |

### sh-dp32-st4 vs sh

| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t5-bounce | sh-diffuse | settled | +2.17 | +3.35 | +0.95 | 0.69 → 0.77 | -20.4 | -32.5 | +9.4 | +1.0 | +42 | +9 | **fails** (bump +42 %) |
| t5-bounce | sh-specular | settled | +1.11 | +1.10 | +1.16 | 0.31 → 0.40 | -10.0 | -12.9 | -5.7 | -0.6 | +1 | +3 | ok |
| t5-bumpy | sh-diffuse | settled | +1.76 | +2.59 | +0.55 | 0.70 → 0.73 | -15.2 | -27.7 | +4.0 | +1.9 | +25 | +6 | ok |
| t5-bumpy | sh-specular | settled | +0.82 | +0.91 | +0.54 | 0.27 → 0.33 | -9.3 | -12.2 | -4.5 | -0.5 | -6 | +0 | ok |
| t5-fine | sh-diffuse | settled | +0.80 | +1.32 | -0.08 | 0.66 → 0.71 | -7.7 | -12.3 | +8.2 | +4.3 | +41 | +13 | **fails** (bump +41 %) |
| t5-fine | sh-specular | settled | +0.92 | +0.95 | +0.69 | 0.17 → 0.25 | -9.6 | -11.0 | -3.3 | -0.3 | +9 | +1 | **fails** (bump +9 %) |
| t5-grooves | sh-diffuse | settled | +2.41 | +2.69 | +0.53 | 0.62 → 0.65 | -22.7 | -28.3 | +2.7 | +0.6 | +15 | +8 | ok |
| t5-grooves | sh-specular | settled | +0.60 | +0.71 | +0.25 | 0.27 → 0.29 | -13.3 | -17.3 | -0.7 | -0.2 | +1 | +1 | ok |
| t5-light | sh-diffuse | pre | +1.82 | +2.89 | +0.57 | 0.71 → 0.76 | -13.7 | -25.6 | +53.8 | +4.2 | +65 | +5 | **fails** (all +16 %, bump +65 %) |
| t5-light | sh-diffuse | move | +0.48 | +1.37 | +0.16 | 0.72 → 0.77 | -6.8 | -16.4 | +25.0 | +1.7 | +57 | +3 | **fails** (all +11 %, bump +57 %) |
| t5-light | sh-diffuse | stop | +1.20 | +2.01 | +0.45 | 0.73 → 0.78 | -9.0 | -20.0 | +48.8 | +3.2 | +86 | +5 | **fails** (all +20 %, bump +86 %, flat +5 %) |
| t5-light | sh-diffuse | hold | +1.62 | +2.50 | +0.61 | 0.73 → 0.77 | -12.8 | -24.5 | +62.1 | +4.2 | +85 | +5 | **fails** (all +20 %, bump +85 %, flat +5 %) |
| t5-light | sh-specular | pre | +1.46 | +1.75 | +0.68 | 0.56 → 0.63 | -11.9 | -15.5 | +5.3 | +1.2 | +2 | +2 | ok |
| t5-light | sh-specular | move | +1.07 | +1.65 | +0.37 | 0.56 → 0.63 | -10.7 | -15.6 | -1.6 | -0.1 | -0 | +0 | ok |
| t5-light | sh-specular | stop | +1.59 | +1.89 | +0.87 | 0.57 → 0.64 | -11.7 | -16.0 | +3.2 | +0.3 | +0 | +2 | ok |
| t5-light | sh-specular | hold | +1.65 | +1.92 | +0.95 | 0.57 → 0.65 | -12.4 | -16.4 | +5.2 | +0.6 | +1 | +2 | ok |
