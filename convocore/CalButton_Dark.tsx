import CalButton from "./CalButton"; // Adjust the path if CalButton is in a different location

const first_name = ""; // TODO: Replace with actual value or prop
const customer_email = ""; // TODO: Replace with actual value or prop

<CalButton
  bookingUrl="https://cal.com/YOUR_HANDLE/30min"
  prefill={{
    name: first_name,
    email: customer_email,
    notes: "Came from NovAIn",
  }}
  params={{
    theme: "dark",
    redirect_url: "https://virtualstrategytech.com/thank-you",
  }}
/>;
