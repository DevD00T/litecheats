import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
	return (
		<Sonner
			theme="dark"
			richColors
			closeButton
			toastOptions={{
				classNames: {
					toast:
						"rounded-xl! border! border-border! bg-card/95! text-card-foreground! shadow-[0_20px_44px_-24px_rgba(0,0,0,0.7)]! backdrop-blur-xl!",
					description: "text-muted-foreground!",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
